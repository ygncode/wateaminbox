import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import type { Kysely } from "kysely";
import { app } from "../app.js";
import { hashPassword } from "../lib/password.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
  type TenantDatabase,
} from "../services/tenant.service.js";

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

/**
 * Stands up a workspace with a tenant schema and an owner session, then hands
 * the caller a tenant handle plus request headers. Mirrors the scaffolding used
 * by the other route integration tests in this directory.
 */
async function withTagWorkspace(
  run: (ctx: {
    headers: Record<string, string>;
    tenantDb: Kysely<TenantDatabase>;
    companyId: string;
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
        name: "Tag route test",
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
    await run({ headers, tenantDb: getTenantConnection(companyId), companyId });
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

describe("PATCH /api/tags/:id", () => {
  integrationTest(
    "answers an empty body with the unchanged tag instead of an unhandled 500",
    async () => {
      await withTagWorkspace(async ({ headers, tenantDb }) => {
        const tagId = crypto.randomUUID();
        await tenantDb
          .insertInto("tags")
          .values({ id: tagId, name: "Priority", color: "#8b5cf6" })
          .execute();

        // `updateTagSchema` accepts `{}`, and Kysely compiled `.set({})` into
        // an `UPDATE ... SET` with no assignments, which PostgreSQL rejected as
        // a syntax error and the route surfaced as a 500.
        const response = await app.request(`/api/tags/${tagId}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({}),
        });

        expect(response.status).toBe(200);
        const body = (await response.json()) as {
          data: { id: string; name: string; color: string | null };
        };
        expect(body.data.id).toBe(tagId);
        expect(body.data.name).toBe("Priority");
        expect(body.data.color).toBe("#8b5cf6");

        const stored = await tenantDb
          .selectFrom("tags")
          .select(["name", "color"])
          .where("id", "=", tagId)
          .executeTakeFirstOrThrow();
        expect(stored).toEqual({ name: "Priority", color: "#8b5cf6" });
      });
    },
  );

  integrationTest(
    "still reports an unknown tag as 404 when the body is empty",
    async () => {
      await withTagWorkspace(async ({ headers }) => {
        // The malformed UPDATE threw before `executeTakeFirst()` could report
        // no row, so the handler's not-found branch was unreachable and a
        // missing id 500'd rather than 404'd.
        const response = await app.request(
          `/api/tags/${crypto.randomUUID()}`,
          { method: "PATCH", headers, body: JSON.stringify({}) },
        );

        expect(response.status).toBe(404);
      });
    },
  );

  integrationTest("applies only the fields the body names", async () => {
    await withTagWorkspace(async ({ headers, tenantDb }) => {
      const tagId = crypto.randomUUID();
      await tenantDb
        .insertInto("tags")
        .values({ id: tagId, name: "Priority", color: "#8b5cf6" })
        .execute();

      const response = await app.request(`/api/tags/${tagId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ color: "#22c55e" }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        data: { name: string; color: string | null };
      };
      expect(body.data.name).toBe("Priority");
      expect(body.data.color).toBe("#22c55e");
    });
  });
});
