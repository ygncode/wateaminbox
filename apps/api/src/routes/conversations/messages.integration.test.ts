import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { DEFAULT_SLA_WEEKLY_SCHEDULE } from "@wateaminbox/shared";
import { sql } from "kysely";
import { app } from "../../app.js";
import { hashPassword } from "../../lib/password.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "../../services/tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

const PASSWORD = "Correct-Horse-123!";

async function loginAndGetHeaders(email: string, companyId: string) {
  const response = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { tokens: { accessToken: string } };
  return {
    authorization: `Bearer ${body.tokens.accessToken}`,
    "x-company-id": companyId,
    "content-type": "application/json",
  };
}

async function withTenantFixture(
  run: (ctx: {
    companyId: string;
    headers: Record<string, string>;
    tenantDb: ReturnType<typeof getTenantConnection>;
  }) => Promise<void>,
): Promise<void> {
  const companyId = crypto.randomUUID();
  const schemaName = getSchemaName(companyId);
  const userId = crypto.randomUUID();
  const email = `pagination-${userId}@example.com`;

  try {
    await db
      .insertInto("users")
      .values({
        id: userId,
        email,
        password_hash: await hashPassword(PASSWORD),
        email_verified_at: new Date(),
      })
      .execute();
    await db
      .insertInto("companies")
      .values({
        id: companyId,
        name: "Pagination test",
        schema_name: schemaName,
        status: "active",
      })
      .execute();
    await db
      .insertInto("company_members")
      .values({ company_id: companyId, user_id: userId, role: "owner" })
      .execute();
    await db
      .insertInto("sla_policies")
      .values({
        company_id: companyId,
        target_minutes: 60,
        direct_resolution_target_minutes: 480,
        group_response_target_minutes: 120,
        group_resolution_target_minutes: 960,
        timezone: "UTC",
        weekly_schedule: JSON.stringify(DEFAULT_SLA_WEEKLY_SCHEDULE),
        exceptions: JSON.stringify([]),
        effective_from: new Date("1970-01-01T00:00:00Z"),
        created_by: userId,
      })
      .execute();
    await createTenantSchema(companyId);

    const headers = await loginAndGetHeaders(email, companyId);
    const tenantDb = getTenantConnection(companyId);

    await run({ companyId, headers, tenantDb });
  } finally {
    await clearTenantConnection(companyId);
    await sql
      .raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
      .execute(db);
    await db
      .deleteFrom("sla_policies")
      .where("company_id", "=", companyId)
      .execute();
    await db
      .deleteFrom("company_members")
      .where("company_id", "=", companyId)
      .execute();
    await db.deleteFrom("companies").where("id", "=", companyId).execute();
    await db.deleteFrom("users").where("id", "=", userId).execute();
  }
}

async function insertContact(
  tenantDb: ReturnType<typeof getTenantConnection>,
) {
  const [contact] = await tenantDb
    .insertInto("contacts")
    .values({
      id: crypto.randomUUID(),
      jid: `${Date.now()}@s.whatsapp.net`,
    })
    .returning("id")
    .execute();
  return contact.id;
}

async function insertMessage(
  tenantDb: ReturnType<typeof getTenantConnection>,
  contactId: string,
  timestamp: Date,
  overrides: Record<string, unknown> = {},
) {
  const id = crypto.randomUUID();
  await tenantDb
    .insertInto("messages")
    .values({
      id,
      contact_id: contactId,
      message_id: `wa_${id}`,
      from_me: false,
      message_type: "text",
      content: `Message ${id.slice(0, 8)}`,
      status: "delivered",
      timestamp,
      created_at: new Date(),
      ...overrides,
    })
    .execute();
  return id;
}

function getMessages(
  headers: Record<string, string>,
  contactId: string,
  params: Record<string, string> = {},
) {
  const qs = new URLSearchParams({ limit: "10", ...params });
  return app.request(
    `/api/conversations/${contactId}/messages?${qs.toString()}`,
    { headers },
  );
}

describe("Conversation tuple-keyset pagination", () => {
  integrationTest(
    "pages through messages with identical timestamps without duplicates or omissions",
    async () => {
      await withTenantFixture(async ({ headers, tenantDb }) => {
        const contactId = await insertContact(tenantDb);
        const sameTs = new Date("2025-06-01T12:00:00Z");

        const ids: string[] = [];
        for (let i = 0; i < 15; i++) {
          ids.push(await insertMessage(tenantDb, contactId, sameTs));
        }

        const allCollected: string[] = [];
        let cursor: string | null = null;
        const pageSize = "5";

        for (let page = 0; page < 5; page++) {
          const params: Record<string, string> = { limit: pageSize };
          if (cursor) params.cursor = cursor;

          const res = await getMessages(headers, contactId, params);
          expect(res.status).toBe(200);
          const body = (await res.json()) as {
            data: {
              messages: { id: string }[];
              hasMore: boolean;
              nextCursor: string | null;
            };
          };

          for (const m of body.data.messages) {
            allCollected.push(m.id);
          }

          if (!body.data.hasMore || !body.data.nextCursor) break;
          cursor = body.data.nextCursor;
        }

        expect(allCollected.length).toBe(15);
        expect(new Set(allCollected).size).toBe(15);

        const allSorted = await tenantDb
          .selectFrom("messages")
          .select("id")
          .where("contact_id", "=", contactId)
          .orderBy("timestamp", "desc")
          .orderBy("id", "desc")
          .execute();
        expect(allCollected).toEqual(allSorted.map((r) => r.id));
      });
    },
  );

  integrationTest(
    "equal timestamps spanning page boundary are not lost",
    async () => {
      await withTenantFixture(async ({ headers, tenantDb }) => {
        const contactId = await insertContact(tenantDb);
        const ts = new Date("2025-06-01T12:00:00Z");

        const ids: string[] = [];
        for (let i = 0; i < 6; i++) {
          ids.push(await insertMessage(tenantDb, contactId, ts));
        }

        const page1 = await getMessages(headers, contactId, { limit: "3" });
        expect(page1.status).toBe(200);
        const body1 = (await page1.json()) as {
          data: {
            messages: { id: string }[];
            hasMore: boolean;
            nextCursor: string;
          };
        };
        expect(body1.data.messages.length).toBe(3);
        expect(body1.data.hasMore).toBe(true);

        const page2 = await getMessages(headers, contactId, {
          limit: "3",
          cursor: body1.data.nextCursor,
        });
        expect(page2.status).toBe(200);
        const body2 = (await page2.json()) as {
          data: { messages: { id: string }[]; hasMore: boolean };
        };
        expect(body2.data.messages.length).toBe(3);

        const allIds = [
          ...body1.data.messages.map((m) => m.id),
          ...body2.data.messages.map((m) => m.id),
        ];
        expect(new Set(allIds).size).toBe(6);
      });
    },
  );

  integrationTest(
    "mixed timestamps and IDs paginate deterministically",
    async () => {
      await withTenantFixture(async ({ headers, tenantDb }) => {
        const contactId = await insertContact(tenantDb);
        const ts1 = new Date("2025-06-01T12:00:00Z");
        const ts2 = new Date("2025-06-01T12:00:01Z");
        const ts3 = new Date("2025-06-01T12:00:02Z");

        await insertMessage(tenantDb, contactId, ts1);
        await insertMessage(tenantDb, contactId, ts1);
        await insertMessage(tenantDb, contactId, ts2);
        await insertMessage(tenantDb, contactId, ts2);
        await insertMessage(tenantDb, contactId, ts3);

        const allCollected: string[] = [];
        let cursor: string | null = null;
        for (let page = 0; page < 5; page++) {
          const params: Record<string, string> = { limit: "2" };
          if (cursor) params.cursor = cursor;

          const res = await getMessages(headers, contactId, params);
          const body = (await res.json()) as {
            data: {
              messages: { id: string }[];
              hasMore: boolean;
              nextCursor: string | null;
            };
          };

          for (const m of body.data.messages) allCollected.push(m.id);
          if (!body.data.hasMore || !body.data.nextCursor) break;
          cursor = body.data.nextCursor;
        }

        expect(allCollected.length).toBe(5);
        expect(new Set(allCollected).size).toBe(5);
      });
    },
  );

  integrationTest("first page is deterministic on repeated requests", async () => {
    await withTenantFixture(async ({ headers, tenantDb }) => {
      const contactId = await insertContact(tenantDb);
      const ts = new Date("2025-06-01T12:00:00Z");
      for (let i = 0; i < 5; i++) {
        await insertMessage(tenantDb, contactId, ts);
      }

      const res1 = await getMessages(headers, contactId, { limit: "3" });
      const body1 = (await res1.json()) as {
        data: { messages: { id: string }[] };
      };
      const res2 = await getMessages(headers, contactId, { limit: "3" });
      const body2 = (await res2.json()) as {
        data: { messages: { id: string }[] };
      };
      expect(body1.data.messages.map((m) => m.id)).toEqual(
        body2.data.messages.map((m) => m.id),
      );
    });
  });

  integrationTest(
    "cursor from another contact is rejected",
    async () => {
      await withTenantFixture(async ({ headers, tenantDb }) => {
        const contact1 = await insertContact(tenantDb);
        const contact2 = await insertContact(tenantDb);
        const ts = new Date("2025-06-01T12:00:00Z");

        const msgId = await insertMessage(tenantDb, contact2, ts);

        const res = await getMessages(headers, contact1, { cursor: msgId });
        expect(res.status).toBe(400);
      });
    },
  );

  integrationTest("limit 1 works correctly", async () => {
    await withTenantFixture(async ({ headers, tenantDb }) => {
      const contactId = await insertContact(tenantDb);
      const ts = new Date("2025-06-01T12:00:00Z");
      await insertMessage(tenantDb, contactId, ts);
      await insertMessage(tenantDb, contactId, ts);

      const allCollected: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 5; page++) {
        const params: Record<string, string> = { limit: "1" };
        if (cursor) params.cursor = cursor;

        const res = await getMessages(headers, contactId, params);
        const body = (await res.json()) as {
          data: {
            messages: { id: string }[];
            hasMore: boolean;
            nextCursor: string | null;
          };
        };
        for (const m of body.data.messages) allCollected.push(m.id);
        if (!body.data.hasMore || !body.data.nextCursor) break;
        cursor = body.data.nextCursor;
      }

      expect(allCollected.length).toBe(2);
      expect(new Set(allCollected).size).toBe(2);
    });
  });
});
