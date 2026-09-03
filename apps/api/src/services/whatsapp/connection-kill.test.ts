import { describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import type { TenantDatabase } from "../tenant.service.js";
import { killConnection } from "./connection.js";

function disconnectedTenantDb() {
  const statements: string[] = [];

  const selectBuilder = (table: string) => {
    const builder = {
      select: () => builder,
      where: () => builder,
      orderBy: () => builder,
      executeTakeFirst: async () =>
        table === "whatsapp_connections"
          ? { id: "connection-1", status: "disconnected" }
          : { id: "session-1" },
    };
    return builder;
  };
  const writeBuilder = (statement: string) => {
    const builder = {
      values: () => builder,
      set: () => builder,
      where: () => builder,
      execute: async () => {
        statements.push(statement);
      },
    };
    return builder;
  };
  const trx = {
    selectFrom: (table: string) => selectBuilder(table),
    updateTable: (table: string) => writeBuilder(`update ${table}`),
    insertInto: (table: string) => writeBuilder(`insert ${table}`),
  };

  return {
    db: {
      selectFrom: (table: string) => selectBuilder(table),
      transaction: () => ({
        execute: <T>(run: (executor: typeof trx) => Promise<T>) => run(trx),
      }),
    } as unknown as Kysely<TenantDatabase>,
    statements,
  };
}

describe("connection worker stop", () => {
  test("queues a kill for a database-disconnected account", async () => {
    const fake = disconnectedTenantDb();

    await killConnection(fake.db, "company-1", "connection-1");

    expect(fake.statements).toContain("update whatsapp_connections");
    expect(fake.statements).toContain("update whatsapp_connection_sessions");
    expect(fake.statements).toContain("insert nats_outbox");
  });
});
