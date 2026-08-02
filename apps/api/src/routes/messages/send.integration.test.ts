import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { DEFAULT_SLA_WEEKLY_SCHEDULE } from "@wateaminbox/shared";
import { sql } from "kysely";
import { app } from "../../app.js";
import { hashPassword } from "../../lib/password.js";
import { openOrReopenCaseForInboundMessage } from "../../services/conversation-case.service.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
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

async function withTenantAndUsers(
  run: (ctx: {
    companyId: string;
    ownerHeaders: Record<string, string>;
    createMember: (
      permissions?: Record<string, boolean>,
    ) => Promise<{ headers: Record<string, string>; userId: string }>;
  }) => Promise<void>,
): Promise<void> {
  const companyId = crypto.randomUUID();
  const schemaName = getSchemaName(companyId);
  const ownerId = crypto.randomUUID();
  const ownerEmail = `owner-${ownerId}@example.com`;
  const memberIds: string[] = [];

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
        name: "Send access route test",
        schema_name: schemaName,
        status: "active",
      })
      .execute();
    await db
      .insertInto("company_members")
      .values({ company_id: companyId, user_id: ownerId, role: "owner" })
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
        created_by: ownerId,
      })
      .execute();
    await createTenantSchema(companyId);

    const ownerHeaders = await loginAndGetHeaders(
      ownerEmail,
      PASSWORD,
      companyId,
    );

    const createMember = async (permissions?: Record<string, boolean>) => {
      const memberId = crypto.randomUUID();
      const memberEmail = `member-${memberId}@example.com`;
      memberIds.push(memberId);
      await db
        .insertInto("users")
        .values({
          id: memberId,
          email: memberEmail,
          password_hash: await hashPassword(PASSWORD),
          email_verified_at: new Date(),
        })
        .execute();
      await db
        .insertInto("company_members")
        .values({
          company_id: companyId,
          user_id: memberId,
          role: "member",
          ...(permissions ? { permissions } : {}),
        })
        .execute();
      const headers = await loginAndGetHeaders(memberEmail, PASSWORD, companyId);
      return { headers, userId: memberId };
    };

    await run({ companyId, ownerHeaders, createMember });
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
    await db.deleteFrom("users").where("id", "=", ownerId).execute();
    for (const memberId of memberIds) {
      await db.deleteFrom("users").where("id", "=", memberId).execute();
    }
  }
}

async function setupSendableContact(companyId: string) {
  const tenantDb = getTenantConnection(companyId);
  const connectionId = crypto.randomUUID();
  await tenantDb
    .insertInto("whatsapp_connections")
    .values({
      id: connectionId,
      name: "Route test connection",
      jid: "15550000000@s.whatsapp.net",
      status: "connected",
    })
    .execute();
  await tenantDb
    .insertInto("whatsapp_connection_sessions")
    .values({
      whatsapp_connection_id: connectionId,
      status: "connected",
      started_at: new Date(),
      connected_at: new Date(),
    })
    .execute();
  const [contact] = await tenantDb
    .insertInto("contacts")
    .values({
      whatsapp_connection_id: connectionId,
      jid: `${crypto.randomUUID()}@s.whatsapp.net`,
      phone_number: crypto.randomUUID().slice(0, 10),
      push_name: "Route test contact",
    })
    .returning("id")
    .execute();

  await tenantDb.transaction().execute(async (trx) => {
    const messageId = crypto.randomUUID();
    await trx
      .insertInto("messages")
      .values({
        id: messageId,
        contact_id: contact.id,
        message_id: crypto.randomUUID(),
        from_me: false,
        message_type: "text",
        content: "hello",
        timestamp: new Date(),
      })
      .execute();
    return openOrReopenCaseForInboundMessage(
      trx,
      companyId,
      { id: contact.id, isGroup: false },
      { id: messageId, timestamp: new Date() },
    );
  });

  return contact.id;
}

describe("POST /api/messages - assignment-aware send access", () => {
  integrationTest(
    "blocks a member from sending to a contact assigned to someone else, and allows it again after takeover",
    async () => {
      await withTenantAndUsers(async ({ companyId, createMember }) => {
        const contactId = await setupSendableContact(companyId);
        const { headers: headersA } = await createMember();
        const { headers: headersB } = await createMember({
          can_assign_contacts: true,
          can_view_all_chats: true,
        });

        // userA claims it by sending first - the contact was unassigned,
        // so the send route's own ensureContactAssignment auto-claims it
        // (mirrors first-reply auto-assignment; matches the "allows
        // sending to an unassigned contact" test below).
        const firstSend = await app.request("/api/messages", {
          method: "POST",
          headers: headersA,
          body: JSON.stringify({
            contactId,
            content: "hi",
            messageType: "text",
          }),
        });
        expect(firstSend.status).toBe(200);

        // userB (without a takeover) is blocked from sending.
        const blockedSend = await app.request("/api/messages", {
          method: "POST",
          headers: headersB,
          body: JSON.stringify({
            contactId,
            content: "hi",
            messageType: "text",
          }),
        });
        expect(blockedSend.status).toBe(403);

        // userB takes over (has can_assign_contacts).
        const takeoverResponse = await app.request(
          `/api/contacts/${contactId}/assign`,
          { method: "POST", headers: headersB, body: "{}" },
        );
        expect(takeoverResponse.status).toBe(201);

        // Now userB can send, and userA is blocked.
        const sendAfterTakeover = await app.request("/api/messages", {
          method: "POST",
          headers: headersB,
          body: JSON.stringify({
            contactId,
            content: "hi",
            messageType: "text",
          }),
        });
        expect(sendAfterTakeover.status).toBe(200);

        const blockedA = await app.request("/api/messages", {
          method: "POST",
          headers: headersA,
          body: JSON.stringify({
            contactId,
            content: "hi",
            messageType: "text",
          }),
        });
        expect(blockedA.status).toBe(403);
      });
    },
  );

  integrationTest(
    "allows sending to an unassigned contact (auto-assigns the sender)",
    async () => {
      await withTenantAndUsers(async ({ companyId, createMember }) => {
        const contactId = await setupSendableContact(companyId);
        const { headers } = await createMember();

        const response = await app.request("/api/messages", {
          method: "POST",
          headers,
          body: JSON.stringify({
            contactId,
            content: "hi",
            messageType: "text",
          }),
        });
        expect(response.status).toBe(200);
      });
    },
  );
});
