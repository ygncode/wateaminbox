import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { DEFAULT_SLA_WEEKLY_SCHEDULE } from "@wateaminbox/shared";
import { sql } from "kysely";
import { app } from "../app.js";
import { hashPassword } from "../lib/password.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "./tenant.service.js";

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
    userId: string;
    headers: Record<string, string>;
    tenantDb: ReturnType<typeof getTenantConnection>;
  }) => Promise<void>,
): Promise<void> {
  const companyId = crypto.randomUUID();
  const schemaName = getSchemaName(companyId);
  const userId = crypto.randomUUID();
  const email = `inbox-lateral-${userId}@example.com`;

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
        name: "Inbox lateral test",
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

    await run({ companyId, userId, headers, tenantDb });
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
  overrides: Record<string, unknown> = {},
) {
  const id = crypto.randomUUID();
  const [contact] = await tenantDb
    .insertInto("contacts")
    .values({
      id,
      jid: `${Date.now()}-${id.slice(0, 8)}@s.whatsapp.net`,
      push_name: `Contact ${id.slice(0, 6)}`,
      ...overrides,
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

interface ContactResponse {
  id: string;
  lastMessage: {
    id: string;
    messageId: string | null;
    fromMe: boolean;
    sentByUserId: string | null;
    sentByUserName: string | null;
    messageType: string;
    content: string | null;
    status: string;
    timestamp: string;
  } | null;
  lastMessageAt: string | null;
  pushName: string | null;
  isGroup: boolean;
  connection: { id: string } | null;
}

function getContacts(
  headers: Record<string, string>,
  params: Record<string, string> = {},
) {
  const qs = new URLSearchParams(params);
  return app.request(`/api/contacts?${qs.toString()}`, { headers });
}

describe("Inbox lateral-join query", () => {
  integrationTest(
    "tied latest timestamps return deterministic last message per contact",
    async () => {
      await withTenantFixture(async ({ headers, tenantDb }) => {
        const sameTs = new Date("2025-06-01T12:00:00Z");

        const contactA = await insertContact(tenantDb);
        const contactB = await insertContact(tenantDb);

        const msgA1 = await insertMessage(tenantDb, contactA, sameTs);
        const msgA2 = await insertMessage(tenantDb, contactA, sameTs);
        const msgB1 = await insertMessage(tenantDb, contactB, sameTs);
        const msgB2 = await insertMessage(tenantDb, contactB, sameTs);

        const res = await getContacts(headers, { limit: "10" });
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          data: ContactResponse[];
        };

        const contactARow = body.data.find((c) => c.id === contactA);
        const contactBRow = body.data.find((c) => c.id === contactB);
        expect(contactARow).toBeDefined();
        expect(contactBRow).toBeDefined();

        // Lateral uses ORDER BY timestamp DESC, id DESC — highest UUID wins
        const expectedA = msgA1 > msgA2 ? msgA1 : msgA2;
        const expectedB = msgB1 > msgB2 ? msgB1 : msgB2;
        expect(contactARow!.lastMessage!.id).toBe(expectedA);
        expect(contactBRow!.lastMessage!.id).toBe(expectedB);

        // Both calls must return the same result (deterministic)
        const res2 = await getContacts(headers, { limit: "10" });
        const body2 = (await res2.json()) as { data: ContactResponse[] };
        const contactARow2 = body2.data.find((c) => c.id === contactA);
        expect(contactARow2!.lastMessage!.id).toBe(expectedA);
      });
    },
  );

  integrationTest(
    "returned last-message includes all expected fields",
    async () => {
      await withTenantFixture(async ({ headers, tenantDb }) => {
        const contactId = await insertContact(tenantDb);
        const ts = new Date("2025-06-01T12:00:00Z");
        const msgId = await insertMessage(tenantDb, contactId, ts, {
          from_me: true,
          message_type: "image",
          content: "photo.jpg",
          status: "read",
        });

        const res = await getContacts(headers, { limit: "10" });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: ContactResponse[] };
        const row = body.data.find((c) => c.id === contactId);
        expect(row).toBeDefined();
        expect(row!.lastMessage).not.toBeNull();

        const lm = row!.lastMessage!;
        expect(lm.id).toBe(msgId);
        expect(lm.messageId).toBe(`wa_${msgId}`);
        expect(lm.fromMe).toBe(true);
        expect(lm.messageType).toBe("image");
        expect(lm.content).toBe("photo.jpg");
        expect(lm.status).toBe("read");
        expect(lm.timestamp).toBeTruthy();
        // sentByUserId is null because we didn't set it
        expect(lm.sentByUserId).toBeNull();
        expect(lm.sentByUserName).toBeNull();
      });
    },
  );

  integrationTest(
    "contact with zero messages appears with null lastMessage and lastMessageAt",
    async () => {
      await withTenantFixture(async ({ headers, tenantDb }) => {
        await insertContact(tenantDb);

        const res = await getContacts(headers, { limit: "10" });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: ContactResponse[] };

        expect(body.data.length).toBe(1);
        expect(body.data[0].lastMessage).toBeNull();
        expect(body.data[0].lastMessageAt).toBeNull();
      });
    },
  );

  integrationTest(
    "search filter excludes contacts even with recent messages",
    async () => {
      await withTenantFixture(async ({ headers, tenantDb }) => {
        const contactMatch = await insertContact(tenantDb, {
          push_name: "Alice Wonderland",
        });
        const contactNoMatch = await insertContact(tenantDb, {
          push_name: "Bob Builder",
        });

        const ts = new Date("2025-06-01T12:00:00Z");
        // Give Bob a more recent message
        await insertMessage(tenantDb, contactMatch, ts);
        await insertMessage(
          tenantDb,
          contactNoMatch,
          new Date("2025-06-02T12:00:00Z"),
        );

        const res = await getContacts(headers, {
          limit: "10",
          search: "Alice",
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: ContactResponse[] };

        expect(body.data.length).toBe(1);
        expect(body.data[0].id).toBe(contactMatch);
      });
    },
  );

  integrationTest(
    "connectionId filter scopes results to one WhatsApp account",
    async () => {
      await withTenantFixture(async ({ headers, tenantDb }) => {
        const connA = crypto.randomUUID();
        const connB = crypto.randomUUID();
        await tenantDb
          .insertInto("whatsapp_connections")
          .values([
            { id: connA, name: "Phone A" },
            { id: connB, name: "Phone B" },
          ])
          .execute();

        const contactA = await insertContact(tenantDb, {
          whatsapp_connection_id: connA,
        });
        const contactB = await insertContact(tenantDb, {
          whatsapp_connection_id: connB,
        });

        const ts = new Date("2025-06-01T12:00:00Z");
        await insertMessage(tenantDb, contactA, ts);
        await insertMessage(tenantDb, contactB, ts);

        const res = await getContacts(headers, {
          limit: "10",
          connectionId: connA,
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: ContactResponse[] };

        expect(body.data.length).toBe(1);
        expect(body.data[0].id).toBe(contactA);
      });
    },
  );

  integrationTest(
    "includeGroups=false excludes group contacts",
    async () => {
      await withTenantFixture(async ({ headers, tenantDb }) => {
        const directContact = await insertContact(tenantDb);
        const groupContact = await insertContact(tenantDb, {
          is_group: true,
          jid: `${Date.now()}@g.us`,
        });

        const ts = new Date("2025-06-01T12:00:00Z");
        await insertMessage(tenantDb, directContact, ts);
        await insertMessage(tenantDb, groupContact, ts);

        // Default is includeGroups=false
        const res = await getContacts(headers, { limit: "10" });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: ContactResponse[] };

        const ids = body.data.map((c) => c.id);
        expect(ids).toContain(directContact);
        expect(ids).not.toContain(groupContact);

        // With includeGroups=true
        const res2 = await getContacts(headers, {
          limit: "10",
          includeGroups: "true",
        });
        expect(res2.status).toBe(200);
        const body2 = (await res2.json()) as { data: ContactResponse[] };
        const ids2 = body2.data.map((c) => c.id);
        expect(ids2).toContain(directContact);
        expect(ids2).toContain(groupContact);
      });
    },
  );
});
