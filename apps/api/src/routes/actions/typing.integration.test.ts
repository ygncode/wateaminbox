import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { DEFAULT_SLA_WEEKLY_SCHEDULE } from "@wateaminbox/shared";
import { sql } from "kysely";
import { app } from "../../app.js";
import { hashPassword } from "../../lib/password.js";
import { assignContactToUser } from "../../services/contact.service.js";
import {
  openOrReopenCaseForInboundMessage,
  resolveActiveCase,
} from "../../services/conversation-case.service.js";
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
    ownerId: string;
    createMember: () => Promise<{
      headers: Record<string, string>;
      userId: string;
    }>;
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
        name: "Typing route test",
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

    const createMember = async () => {
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
        .values({ company_id: companyId, user_id: memberId, role: "member" })
        .execute();
      const headers = await loginAndGetHeaders(memberEmail, PASSWORD, companyId);
      return { headers, userId: memberId };
    };

    await run({ companyId, ownerHeaders, ownerId, createMember });
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

async function setupContactWithCase(companyId: string) {
  const tenantDb = getTenantConnection(companyId);
  const connectionId = crypto.randomUUID();
  const jid = `${crypto.randomUUID()}@s.whatsapp.net`;
  await tenantDb
    .insertInto("whatsapp_connections")
    .values({
      id: connectionId,
      name: "Typing test connection",
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
      jid,
      phone_number: crypto.randomUUID().slice(0, 10),
      push_name: "Typing test contact",
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

  return { contactId: contact.id, jid };
}

describe("POST /api/actions/messages/typing - assignment-aware access", () => {
  integrationTest(
    "allows starting typing for an unassigned or self-assigned contact",
    async () => {
      await withTenantAndUsers(async ({ companyId, ownerHeaders }) => {
        const { contactId, jid } = await setupContactWithCase(companyId);

        const response = await app.request("/api/actions/messages/typing", {
          method: "POST",
          headers: ownerHeaders,
          body: JSON.stringify({
            conversationId: jid,
            contactId,
            isTyping: true,
          }),
        });
        expect(response.status).toBe(200);
      });
    },
  );

  integrationTest(
    "blocks starting typing for a contact assigned to another team member",
    async () => {
      await withTenantAndUsers(
        async ({ companyId, ownerId, createMember }) => {
          const { contactId, jid } = await setupContactWithCase(companyId);
          const tenantDb = getTenantConnection(companyId);
          const { headers } = await createMember();
          // The owner claims the contact first.
          await assignContactToUser(tenantDb, contactId, ownerId, ownerId);

          const response = await app.request(
            "/api/actions/messages/typing",
            {
              method: "POST",
              headers,
              body: JSON.stringify({
                conversationId: jid,
                contactId,
                isTyping: true,
              }),
            },
          );
          expect(response.status).toBe(403);
        },
      );
    },
  );

  integrationTest(
    "stopping typing is always allowed, even for a contact assigned to someone else",
    async () => {
      await withTenantAndUsers(
        async ({ companyId, ownerId, createMember }) => {
          const { contactId, jid } = await setupContactWithCase(companyId);
          const tenantDb = getTenantConnection(companyId);
          const { headers } = await createMember();
          await assignContactToUser(tenantDb, contactId, ownerId, ownerId);

          const response = await app.request(
            "/api/actions/messages/typing",
            {
              method: "POST",
              headers,
              body: JSON.stringify({
                conversationId: jid,
                contactId,
                isTyping: false,
              }),
            },
          );
          expect(response.status).toBe(200);
        },
      );
    },
  );

  integrationTest(
    "blocks starting typing once the conversation is resolved",
    async () => {
      await withTenantAndUsers(async ({ companyId, ownerHeaders }) => {
        const { contactId, jid } = await setupContactWithCase(companyId);
        const tenantDb = getTenantConnection(companyId);
        await resolveActiveCase(tenantDb, contactId, {
          outcome: "no_reply_needed",
          resolvedBy: crypto.randomUUID(),
        });

        const response = await app.request("/api/actions/messages/typing", {
          method: "POST",
          headers: ownerHeaders,
          body: JSON.stringify({
            conversationId: jid,
            contactId,
            isTyping: true,
          }),
        });
        expect(response.status).toBe(409);
      });
    },
  );
});
