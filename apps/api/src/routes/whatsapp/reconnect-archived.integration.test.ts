import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import type { Kysely } from "kysely";
import { app } from "../../app.js";
import { hashPassword } from "../../lib/password.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
  type TenantDatabase,
} from "../../services/tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

const PASSWORD = "Correct-Horse-123!";

async function loginAndGetHeaders(
  email: string,
  password: string,
  companyId: string,
) {
  const response = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { tokens: { accessToken: string } };
  return {
    authorization: `Bearer ${body.tokens.accessToken}`,
    "x-company-id": companyId,
    "content-type": "application/json",
  };
}

async function withWorkspace(
  run: (ctx: {
    companyId: string;
    headers: Record<string, string>;
    tenantDb: Kysely<TenantDatabase>;
  }) => Promise<void>,
): Promise<void> {
  const companyId = crypto.randomUUID();
  const schemaName = getSchemaName(companyId);
  const ownerId = crypto.randomUUID();
  const ownerEmail = `owner-${ownerId}@example.com`;

  try {
    await db
      .insertInto("users")
      .values({
        id: ownerId,
        email: ownerEmail,
        password_hash: await hashPassword(PASSWORD),
        email_verified_at: new Date(),
      })
      .execute();
    await db
      .insertInto("companies")
      .values({
        id: companyId,
        name: "Archived reconnect test",
        schema_name: schemaName,
        status: "active",
      })
      .execute();
    await db
      .insertInto("company_members")
      .values({ company_id: companyId, user_id: ownerId, role: "owner" })
      .execute();
    await createTenantSchema(companyId);

    const headers = await loginAndGetHeaders(ownerEmail, PASSWORD, companyId);
    await run({ companyId, headers, tenantDb: getTenantConnection(companyId) });
  } finally {
    await clearTenantConnection(companyId);
    await sql.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).execute(db);
    await db
      .deleteFrom("company_members")
      .where("company_id", "=", companyId)
      .execute();
    await db.deleteFrom("companies").where("id", "=", companyId).execute();
    await db.deleteFrom("users").where("id", "=", ownerId).execute();
  }
}

async function insertConnection(
  tenantDb: Kysely<TenantDatabase>,
  values: { status: "disconnected" | "connected"; archived?: boolean },
) {
  const connectionId = crypto.randomUUID();
  await tenantDb
    .insertInto("whatsapp_connections")
    .values({
      id: connectionId,
      name: "Support line",
      phone_number: "15550000001",
      jid: "15550000001@s.whatsapp.net",
      status: values.status,
      ...(values.archived ? { archived_at: new Date() } : {}),
    })
    .execute();
  return connectionId;
}

async function readConnection(
  tenantDb: Kysely<TenantDatabase>,
  connectionId: string,
) {
  return tenantDb
    .selectFrom("whatsapp_connections")
    .select(["status", "archived_at"])
    .where("id", "=", connectionId)
    .executeTakeFirstOrThrow();
}

describe("POST /api/whatsapp/connections/:id/reconnect", () => {
  integrationTest(
    "refuses an archived connection and points at relink instead of manufacturing a pending row",
    async () => {
      await withWorkspace(async ({ headers, tenantDb }) => {
        const connectionId = await insertConnection(tenantDb, {
          status: "disconnected",
          archived: true,
        });

        const response = await app.request(
          `/api/whatsapp/connections/${connectionId}/reconnect`,
          { method: "POST", headers },
        );

        // Archived rows carry status "disconnected", so the status-only guard
        // let them through and the route wrote `pending` without clearing
        // `archived_at`. That impossible row matched `getConnectionLimits`'
        // `connected|pending` filter and 429'd legitimate spawns.
        expect(response.status).toBe(409);
        const body = (await response.json()) as { error: string };
        expect(body.error).toContain("archived");

        const row = await readConnection(tenantDb, connectionId);
        expect(row.status).toBe("disconnected");
        expect(row.archived_at).not.toBeNull();
      });
    },
  );

  integrationTest(
    "leaves an archived connection reachable through the relink path",
    async () => {
      await withWorkspace(async ({ headers, tenantDb }) => {
        const connectionId = await insertConnection(tenantDb, {
          status: "disconnected",
          archived: true,
        });

        // The rejection above is only safe if the archive-aware path still
        // works, so the guidance in the error message is real.
        const response = await app.request(
          `/api/whatsapp/connections/${connectionId}/relink`,
          { method: "POST", headers },
        );

        expect(response.status).toBe(200);
        const row = await readConnection(tenantDb, connectionId);
        expect(row.status).toBe("pending");
        expect(row.archived_at).toBeNull();
      });
    },
  );

  integrationTest("still reconnects a live connection that is not archived", async () => {
    await withWorkspace(async ({ headers, tenantDb }) => {
      const connectionId = await insertConnection(tenantDb, {
        status: "disconnected",
      });

      const response = await app.request(
        `/api/whatsapp/connections/${connectionId}/reconnect`,
        { method: "POST", headers },
      );

      expect(response.status).toBe(200);
      const row = await readConnection(tenantDb, connectionId);
      expect(row.status).toBe("pending");
      expect(row.archived_at).toBeNull();
    });
  });
});
