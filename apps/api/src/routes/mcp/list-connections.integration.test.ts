import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import type { Context } from "hono";
import { sql } from "kysely";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "../../services/tenant.service.js";
import { readTools } from "./tools/read.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;
const TEST_TIMEOUT_MS = 30_000;

const listConnections = readTools.find((t) => t.name === "list_connections");
if (!listConnections) throw new Error("list_connections tool not found");

function fakeContext(values: Record<string, unknown>): Context {
  return {
    get: (key: string) => values[key],
    req: { header: () => undefined },
  } as unknown as Context;
}

async function withWorkspace(
  run: (ctx: {
    tenantDb: ReturnType<typeof getTenantConnection>;
    c: Context;
  }) => Promise<void>,
): Promise<void> {
  const companyId = crypto.randomUUID();
  const schemaName = getSchemaName(companyId);
  const userId = crypto.randomUUID();
  try {
    await db
      .insertInto("users")
      .values({
        id: userId,
        email: `conn-${userId}@example.com`,
        password_hash: "x",
        email_verified_at: new Date(),
      })
      .execute();
    await db
      .insertInto("companies")
      .values({
        id: companyId,
        name: "list_connections test",
        schema_name: schemaName,
        status: "active",
      })
      .execute();
    await db
      .insertInto("company_members")
      .values({ company_id: companyId, user_id: userId, role: "owner" })
      .execute();
    await createTenantSchema(companyId);

    const tenantDb = getTenantConnection(companyId);
    await run({
      tenantDb,
      c: fakeContext({
        tenantDb,
        companyId,
        user: { id: userId, email: `conn-${userId}@example.com` },
        companyPermissions: { can_view_all_chats: true },
        companyRole: "owner",
        apiToken: { id: crypto.randomUUID() },
      }),
    });
  } finally {
    await clearTenantConnection(companyId);
    await sql.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).execute(db);
    await db
      .deleteFrom("company_members")
      .where("company_id", "=", companyId)
      .execute();
    await db.deleteFrom("companies").where("id", "=", companyId).execute();
    await db.deleteFrom("users").where("id", "=", userId).execute();
  }
}

describe("list_connections", () => {
  integrationTest(
    "returns the id a caller needs alongside the phone number it knows",
    () =>
      withWorkspace(async ({ tenantDb, c }) => {
        await tenantDb
          .insertInto("whatsapp_connections")
          .values([
            {
              name: "WATEAMINBOX-SG",
              phone_number: "6584042683",
              jid: "6584042683:30@s.whatsapp.net",
              status: "connected",
            },
            {
              name: "MMPhone",
              phone_number: "959428203611",
              jid: "959428203611:58@s.whatsapp.net",
              status: "connected",
            },
          ])
          .execute();

        const result = (await listConnections.handler({}, c)) as {
          connections: Array<{
            connectionId: string;
            phoneNumber: string | null;
            name: string | null;
            status: string;
          }>;
        };

        expect(result.connections).toHaveLength(2);
        // The whole point: a caller holding a phone number can reach an id.
        const sg = result.connections.find(
          (conn) => conn.phoneNumber === "6584042683",
        );
        expect(sg).toBeDefined();
        expect(sg?.connectionId).toMatch(/^[0-9a-f-]{36}$/);
        expect(sg?.name).toBe("WATEAMINBOX-SG");
      }),
    TEST_TIMEOUT_MS,
  );

  integrationTest(
    "hides disconnected and archived accounts unless asked",
    () =>
      withWorkspace(async ({ tenantDb, c }) => {
        await tenantDb
          .insertInto("whatsapp_connections")
          .values([
            { name: "Live", phone_number: "1", status: "connected" },
            { name: "Offline", phone_number: "2", status: "disconnected" },
            {
              name: "Archived",
              phone_number: "3",
              status: "connected",
              archived_at: new Date(),
            },
          ])
          .execute();

        const active = (await listConnections.handler({}, c)) as {
          connections: Array<{ name: string | null }>;
        };
        // Offering an account that cannot send only invites a failed call.
        expect(active.connections.map((conn) => conn.name)).toEqual(["Live"]);

        const all = (await listConnections.handler(
          { includeDisconnected: true },
          c,
        )) as { connections: Array<{ name: string | null }> };
        expect(all.connections.map((conn) => conn.name).sort()).toEqual([
          "Live",
          "Offline",
        ]);
        // Archived stays hidden either way - it cannot be revived by a flag.
        expect(all.connections.map((conn) => conn.name)).not.toContain(
          "Archived",
        );
      }),
    TEST_TIMEOUT_MS,
  );
});
