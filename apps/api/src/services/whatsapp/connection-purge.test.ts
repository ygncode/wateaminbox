import { describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import {
  ConnectionNotArchivedError,
  ConnectionNotFoundError,
} from "../../lib/errors.js";
import type { TenantDatabase } from "../tenant.service.js";
import { purgeArchivedConnection } from "./connection.js";

/**
 * A recording stand-in for a tenant transaction. It answers the reads the
 * purge performs and remembers every write statement, in execution order, so
 * the ordering the tenant schema's foreign keys demand can be asserted without
 * a database. See connection-purge.integration.test.ts for the real one.
 */
function fakeTenantDb(rows: {
  connection?: { id: string; archived_at: Date | null };
  contacts?: Array<{ id: string }>;
  scheduled_messages?: Array<{
    bulk_job_id: string | null;
    status?: string;
    count?: number;
  }>;
  deletedMessageCount?: number;
}) {
  const statements: string[] = [];

  const selectBuilder = (table: string) => {
    const builder = {
      select: () => builder,
      distinct: () => builder,
      where: () => builder,
      groupBy: () => builder,
      forUpdate: () => builder,
      executeTakeFirst: async () =>
        table === "whatsapp_connections" ? rows.connection : undefined,
      execute: async () =>
        table === "contacts"
          ? (rows.contacts ?? [])
          : table === "scheduled_messages"
            ? (rows.scheduled_messages ?? [])
            : [],
    };
    return builder;
  };

  const writeBuilder = (statement: string) => {
    const builder = {
      set: () => builder,
      values: () => builder,
      columns: () => builder,
      expression: () => builder,
      onConflict: () => builder,
      where: () => builder,
      execute: async () => {
        statements.push(statement);
        return [];
      },
      executeTakeFirst: async () => {
        statements.push(statement);
        return { numDeletedRows: BigInt(rows.deletedMessageCount ?? 0) };
      },
    };
    return builder;
  };

  const trx = {
    selectFrom: (table: string) => selectBuilder(table),
    insertInto: (table: string) => writeBuilder(`insert ${table}`),
    deleteFrom: (table: string) => writeBuilder(`delete ${table}`),
    updateTable: (table: string) => writeBuilder(`update ${table}`),
  };

  return {
    tenantDb: {
      transaction: () => ({
        execute: <T>(run: (t: typeof trx) => Promise<T>) => run(trx),
      }),
    } as unknown as Kysely<TenantDatabase>,
    statements,
  };
}

const ARCHIVED = {
  id: "connection-1",
  archived_at: new Date("2026-02-01T00:00:00Z"),
};

describe("permanent connection purge", () => {
  test("erases every dependent table in foreign-key-safe order", async () => {
    const fake = fakeTenantDb({
      connection: ARCHIVED,
      contacts: [{ id: "contact-1" }, { id: "contact-2" }],
      scheduled_messages: [{ bulk_job_id: "job-1", status: "sent", count: 1 }],
      deletedMessageCount: 7,
    });

    const result = await purgeArchivedConnection(fake.tenantDb, "connection-1");

    expect(result).toEqual({
      contactIds: ["contact-1", "contact-2"],
      deletedMessageCount: 7,
      affectedBulkJobIds: ["job-1"],
    });

    const at = (statement: string) => {
      const index = fake.statements.indexOf(statement);
      expect(index, `missing statement: ${statement}`).toBeGreaterThanOrEqual(
        0,
      );
      return index;
    };

    // conversation_cases.opening_message_id references messages, so a case
    // still pointing at a message blocks that message's delete - the exact
    // failure this ordering exists to prevent.
    expect(at("delete conversation_cases")).toBeLessThan(at("delete messages"));
    expect(at("update conversation_cases")).toBeLessThan(at("delete messages"));
    // conversation_cases cascade from contacts, so contacts may only go once
    // their messages are gone.
    expect(at("delete messages")).toBeLessThan(at("delete contacts"));
    // group_participants and group_join_requests both cascade from groups,
    // which cascade from contacts.
    expect(at("delete group_participants")).toBeLessThan(at("delete groups"));
    expect(at("delete group_join_requests")).toBeLessThan(at("delete groups"));
    expect(at("delete groups")).toBeLessThan(at("delete contacts"));
    // Everything the connection owns must precede the connection row itself.
    expect(fake.statements.at(-1)).toBe("delete whatsapp_connections");

    expect(fake.statements).toEqual([
      "insert purge_cleanup_items",
      "insert purge_cleanup_items",
      "insert purge_cleanup_items",
      "insert purge_cleanup_items",
      "insert purge_cleanup_items",
      "insert purge_cleanup_items",
      "insert purge_cleanup_items",
      "insert purge_cleanup_items",
      "insert purge_cleanup_items",
      "update bulk_jobs",
      "delete message_reactions",
      "delete conversation_cases",
      "update conversation_cases",
      "delete conversation_states",
      "delete scheduled_messages",
      "delete contact_tags",
      "delete contact_assignments",
      "delete contact_notes_private",
      "delete contact_notes_shared",
      "delete notification_history",
      "delete group_join_requests",
      "delete group_participants",
      "delete groups",
      "delete messages",
      "delete contacts",
      "delete status_updates",
      "delete catalog_products",
      "delete whatsapp_catalogs",
      "delete whatsapp_labels",
      "delete bulk_connection_budgets",
      "delete whatsapp_connection_sessions",
      "delete whatsapp_connections",
    ]);
  });

  test("reports no bulk jobs when the purged contacts had no bulk leaves", async () => {
    const fake = fakeTenantDb({
      connection: ARCHIVED,
      contacts: [{ id: "contact-1" }],
    });

    const result = await purgeArchivedConnection(fake.tenantDb, "connection-1");

    expect(result.affectedBulkJobIds).toEqual([]);
    expect(result.deletedMessageCount).toBe(0);
  });

  test("refuses a connection that is still linked, without deleting anything", async () => {
    const fake = fakeTenantDb({
      connection: { id: "connection-1", archived_at: null },
    });

    await expect(
      purgeArchivedConnection(fake.tenantDb, "connection-1"),
    ).rejects.toBeInstanceOf(ConnectionNotArchivedError);
    expect(fake.statements).toEqual([]);
  });

  // Both refusals reach the client through app.ts's AppError branch, so their
  // status codes are the API contract: a still-linked account is something the
  // operator can fix, never an opaque 500.
  test("maps its refusals to actionable status codes", () => {
    expect(new ConnectionNotArchivedError().statusCode).toBe(409);
    expect(new ConnectionNotArchivedError().message).toContain("Archive");
    expect(new ConnectionNotFoundError("connection-1").statusCode).toBe(404);
  });

  test("reports a missing connection as not found, without deleting anything", async () => {
    const fake = fakeTenantDb({});

    await expect(
      purgeArchivedConnection(fake.tenantDb, "connection-1"),
    ).rejects.toBeInstanceOf(ConnectionNotFoundError);
    expect(fake.statements).toEqual([]);
  });
});
