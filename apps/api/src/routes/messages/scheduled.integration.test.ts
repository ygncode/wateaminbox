import { describe, expect, test } from "bun:test";
import type { MessageStatus } from "@wateaminbox/database";
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

async function withOwner(
  run: (ctx: {
    companyId: string;
    ownerHeaders: Record<string, string>;
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
        name: "Scheduled route quote test",
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

    await run({ companyId, ownerHeaders });
  } finally {
    await clearTenantConnection(companyId);
    await sql.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).execute(db);
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
  }
}

/** Connected connection + session + an unassigned contact with an open case. */
async function setupSendableContact(
  companyId: string,
): Promise<{ contactId: string; connectionId: string }> {
  const tenantDb = getTenantConnection(companyId);
  const connectionId = crypto.randomUUID();
  await tenantDb
    .insertInto("whatsapp_connections")
    .values({
      id: connectionId,
      name: "Scheduled route test connection",
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
      push_name: "Scheduled route test contact",
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

  return { contactId: contact.id, connectionId };
}

async function insertQuoteMessage(
  companyId: string,
  connectionId: string,
  contactId: string,
  options: {
    fromMe: boolean;
    messageId: string;
    status: MessageStatus;
  },
): Promise<string> {
  const tenantDb = getTenantConnection(companyId);
  const id = crypto.randomUUID();
  await tenantDb
    .insertInto("messages")
    .values({
      id,
      contact_id: contactId,
      whatsapp_connection_id: connectionId,
      message_id: options.messageId,
      from_me: options.fromMe,
      status: options.status,
      message_type: "text",
      content: "original",
      timestamp: new Date(),
    })
    .execute();
  return id;
}

function scheduleBody(contactId: string, replyToMessageId?: string) {
  return JSON.stringify({
    contactId,
    content: "scheduled reply",
    messageType: "text",
    scheduledAt: new Date(Date.now() + 60_000).toISOString(),
    ...(replyToMessageId ? { replyToMessageId } : {}),
  });
}

describe("POST /api/messages/scheduled - quote confirmation guard", () => {
  // The create-time guard mirrors the immediate-send routes: a pending or
  // failed own-message quote carries the synthetic `pending_<uuid>` that
  // WhatsApp never issued, so the schedule must be rejected up front instead
  // of dispatching later with a broken (or dropped) quote.
  const rejectScenarios = [
    {
      name: "rejects a still-pending own-message quote",
      quote: { fromMe: true, messageId: null, status: "pending" },
    },
    {
      name: "rejects an already-failed own-message quote",
      quote: { fromMe: true, messageId: null, status: "failed" },
    },
  ] as const;

  for (const scenario of rejectScenarios) {
    integrationTest(
      scenario.name,
      async () => {
        await withOwner(async ({ companyId, ownerHeaders }) => {
          const tenantDb = getTenantConnection(companyId);
          const { contactId, connectionId } =
            await setupSendableContact(companyId);
          const quoteId = await insertQuoteMessage(
            companyId,
            connectionId,
            contactId,
            {
              fromMe: scenario.quote.fromMe,
              messageId:
                scenario.quote.messageId ?? `pending_${crypto.randomUUID()}`,
              status: scenario.quote.status,
            },
          );

          const response = await app.request("/api/messages/scheduled", {
            method: "POST",
            headers: ownerHeaders,
            body: scheduleBody(contactId, quoteId),
          });
          expect(response.status).toBe(400);
          expect(await response.text()).toContain("confirmed");

          // Rejected before the transaction: no scheduled row is persisted.
          expect(
            await tenantDb
              .selectFrom("scheduled_messages")
              .select("id")
              .execute(),
          ).toHaveLength(0);
        });
      },
      30_000,
    );
  }

  const acceptScenarios = [
    {
      name: "accepts a confirmed own-message quote",
      quote: {
        fromMe: true,
        messageId: "confirmed-own-wa-id",
        status: "sent" as MessageStatus,
      },
    },
    {
      name: "accepts an incoming-message quote",
      quote: {
        fromMe: false,
        messageId: "incoming-wa-id",
        status: "delivered" as MessageStatus,
      },
    },
  ];

  for (const scenario of acceptScenarios) {
    integrationTest(
      scenario.name,
      async () => {
        await withOwner(async ({ companyId, ownerHeaders }) => {
          const tenantDb = getTenantConnection(companyId);
          const { contactId, connectionId } =
            await setupSendableContact(companyId);
          const quoteId = await insertQuoteMessage(
            companyId,
            connectionId,
            contactId,
            scenario.quote,
          );

          const response = await app.request("/api/messages/scheduled", {
            method: "POST",
            headers: ownerHeaders,
            body: scheduleBody(contactId, quoteId),
          });
          expect(response.status).toBe(200);

          const row = await tenantDb
            .selectFrom("scheduled_messages")
            .select(["status", "reply_to_message_id"])
            .executeTakeFirstOrThrow();
          expect(row.status).toBe("scheduled");
          expect(row.reply_to_message_id).toBe(quoteId);
        });
      },
      30_000,
    );
  }

  integrationTest(
    "still returns 404 for a quote that does not exist",
    async () => {
      await withOwner(async ({ companyId, ownerHeaders }) => {
        const tenantDb = getTenantConnection(companyId);
        const { contactId } = await setupSendableContact(companyId);

        const response = await app.request("/api/messages/scheduled", {
          method: "POST",
          headers: ownerHeaders,
          body: scheduleBody(contactId, crypto.randomUUID()),
        });
        expect(response.status).toBe(404);
        expect(await response.text()).toContain("Quoted message");

        expect(
          await tenantDb
            .selectFrom("scheduled_messages")
            .select("id")
            .execute(),
        ).toHaveLength(0);
      });
    },
    30_000,
  );
});
