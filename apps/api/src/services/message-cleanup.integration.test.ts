import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import { cleanupCompanyMessages } from "./message-cleanup.service.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "./tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

interface Fixture {
  companyId: string;
  connectionId: string;
  contactId: string;
}

async function withTenant(run: (fixture: Fixture) => Promise<void>) {
  const companyId = crypto.randomUUID();
  const schemaName = getSchemaName(companyId);
  const connectionId = crypto.randomUUID();
  const contactId = crypto.randomUUID();

  try {
    await db
      .insertInto("companies")
      .values({
        id: companyId,
        name: "Concurrent message cleanup test",
        schema_name: schemaName,
        status: "active",
      })
      .execute();
    await createTenantSchema(companyId);
    const tenantDb = getTenantConnection(companyId);
    await tenantDb
      .insertInto("whatsapp_connections")
      .values({
        id: connectionId,
        name: "Primary",
        phone_number: "15550004444",
        status: "connected",
      })
      .execute();
    await tenantDb
      .insertInto("contacts")
      .values({
        id: contactId,
        whatsapp_connection_id: connectionId,
        jid: "15551235555@s.whatsapp.net",
        phone_number: "15551235555",
      })
      .execute();
    await run({ companyId, connectionId, contactId });
  } finally {
    await clearTenantConnection(companyId);
    await sql.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).execute(db);
    await db.deleteFrom("companies").where("id", "=", companyId).execute();
  }
}

async function insertPending(fixture: Fixture, messageId: string) {
  const id = crypto.randomUUID();
  await getTenantConnection(fixture.companyId)
    .insertInto("messages")
    .values({
      id,
      whatsapp_connection_id: fixture.connectionId,
      contact_id: fixture.contactId,
      message_id: messageId,
      from_me: true,
      message_type: "text",
      content: "stuck",
      status: "pending",
      timestamp: new Date(Date.now() - 60 * 60 * 1000),
    })
    .execute();
  return id;
}

type BroadcastPayload = { messageIds?: string[] };

describe("message cleanup multi-replica safety", () => {
  integrationTest(
    "concurrent runners transition and broadcast a stale row exactly once",
    async () => {
      await withTenant(async (fixture) => {
        const internalId = await insertPending(fixture, "wa-stale-once");
        const broadcasts: string[][] = [];
        const broadcast: NonNullable<
          Parameters<typeof cleanupCompanyMessages>[3]
        > = async (_companyId, _contactId, _eventType, payload) => {
          broadcasts.push((payload as BroadcastPayload).messageIds ?? []);
        };

        // These are separate queries checked out from the real PostgreSQL pool,
        // not serialized calls through a mocked repository.
        const counts = await Promise.all([
          cleanupCompanyMessages(fixture.companyId, 30, 100, broadcast),
          cleanupCompanyMessages(fixture.companyId, 30, 100, broadcast),
        ]);

        expect(counts.reduce((sum, count) => sum + count, 0)).toBe(1);
        expect(broadcasts.flat()).toEqual(["wa-stale-once"]);

        const row = await getTenantConnection(fixture.companyId)
          .selectFrom("messages")
          .select(["status", "metadata"])
          .where("id", "=", internalId)
          .executeTakeFirstOrThrow();
        expect(row.status).toBe("failed");
        expect(row.metadata?.error).toBe("delivery_timeout");
      });
    },
  );

  integrationTest(
    "concurrent runners keep disjoint, strictly bounded batches",
    async () => {
      await withTenant(async (fixture) => {
        await insertPending(fixture, "wa-batch-one");
        await insertPending(fixture, "wa-batch-two");
        await insertPending(fixture, "wa-batch-three");
        const tenantDb = getTenantConnection(fixture.companyId);

        const counts = await Promise.all([
          cleanupCompanyMessages(fixture.companyId, 30, 1, async () => {}),
          cleanupCompanyMessages(fixture.companyId, 30, 1, async () => {}),
        ]);

        expect(counts).toEqual([1, 1]);
        const statuses = await tenantDb
          .selectFrom("messages")
          .select("status")
          .where("message_id", "in", [
            "wa-batch-one",
            "wa-batch-two",
            "wa-batch-three",
          ])
          .execute();
        expect(statuses.filter((row) => row.status === "failed")).toHaveLength(
          2,
        );
        expect(statuses.filter((row) => row.status === "pending")).toHaveLength(
          1,
        );
      });
    },
  );

  integrationTest(
    "a receipt committed while cleanup waits cannot be overwritten by cleanup",
    async () => {
      await withTenant(async (fixture) => {
        const id = await insertPending(fixture, "wa-receipt-race");
        const broadcasts: string[][] = [];
        let cleanupPromise: Promise<number> | undefined;

        await getTenantConnection(fixture.companyId)
          .transaction()
          .execute(async (trx) => {
            await trx
              .selectFrom("messages")
              .select("id")
              .where("id", "=", id)
              .forUpdate()
              .executeTakeFirstOrThrow();

            cleanupPromise = cleanupCompanyMessages(
              fixture.companyId,
              30,
              100,
              async (_companyId, _contactId, _eventType, payload) => {
                broadcasts.push((payload as BroadcastPayload).messageIds ?? []);
              },
            );

            // Give the independently checked-out cleanup query time to reach
            // the row lock, then commit the newer receipt state first.
            await new Promise((resolve) => setTimeout(resolve, 25));
            await trx
              .updateTable("messages")
              .set({ status: "read" })
              .where("id", "=", id)
              .execute();
          });

        expect(await cleanupPromise).toBe(0);
        expect(broadcasts).toEqual([]);
        const row = await getTenantConnection(fixture.companyId)
          .selectFrom("messages")
          .select(["status", "metadata"])
          .where("id", "=", id)
          .executeTakeFirstOrThrow();
        expect(row.status).toBe("read");
        expect(row.metadata).toBeNull();
      });
    },
  );
});
