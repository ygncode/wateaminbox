import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { DEFAULT_SLA_WEEKLY_SCHEDULE } from "@wateaminbox/shared";
import { sql } from "kysely";
import type { MessageEvent } from "../../lib/nats/types/events.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "../tenant.service.js";
import { handleMessageEvent } from "./message-handlers.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

const OWN_JID = "15550000001@s.whatsapp.net";

interface SessionTenant {
  companyId: string;
  /** Durable whatsapp_connections.id. */
  connectionId: string;
  /** Worker session UUID (whatsapp_connection_sessions.id), distinct from connectionId. */
  sessionId: string;
  schema: string;
}

/**
 * After the session/account split (migration 052) the WhatsApp worker stores
 * its whatsmeow rows under whatsapp_connection_sessions.id, not the durable
 * whatsapp_connections.id. handleMessageEvent must therefore filter
 * whatsapp_sessions.whatsmeow_* by the event's session id (falling back to the
 * durable connection id for legacy call sites).
 */
async function withSessionTenant(
  run: (ctx: SessionTenant) => Promise<void>,
): Promise<void> {
  const companyId = crypto.randomUUID();
  const connectionId = crypto.randomUUID();
  const schemaName = getSchemaName(companyId);
  const ownerId = crypto.randomUUID();
  let sessionId = "";

  try {
    await db
      .insertInto("users")
      .values({
        id: ownerId,
        email: `owner-${ownerId}@example.com`,
        password_hash: "test",
      })
      .execute();
    await db
      .insertInto("companies")
      .values({
        id: companyId,
        name: "Whatsmeow session lookup test",
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
    const tenantDb = getTenantConnection(companyId);
    await tenantDb
      .insertInto("whatsapp_connections")
      .values({
        id: connectionId,
        name: "Session lookup test",
        jid: OWN_JID,
        status: "connected",
      })
      .execute();
    // The worker spawned after the split is keyed by a fresh session UUID.
    const session = await tenantDb
      .insertInto("whatsapp_connection_sessions")
      .values({
        whatsapp_connection_id: connectionId,
        status: "connected",
        started_at: new Date(),
        connected_at: new Date(),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    sessionId = session.id;

    await run({ companyId, connectionId, sessionId, schema: schemaName });
  } finally {
    // handleMessageEvent starts an optional fire-and-forget profile-picture
    // request that can still be in flight against the tenant schema when run()
    // resolves - give it a beat to settle before dropping the schema.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await clearTenantConnection(companyId);
    // whatsmeow_* tables live in the shared whatsapp_sessions schema and are
    // not dropped with the tenant schema; remove the rows we wrote so they do
    // not leak across runs.
    for (const id of sessionId ? [connectionId, sessionId] : [connectionId]) {
      await sql`DELETE FROM whatsapp_sessions.whatsmeow_message_secrets WHERE connection_id = ${id}::uuid`.execute(
        db,
      );
      await sql`DELETE FROM whatsapp_sessions.whatsmeow_contacts WHERE connection_id = ${id}::uuid`.execute(
        db,
      );
    }
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

function groupInboundEvent(
  companyId: string,
  connectionId: string,
  overrides: {
    messageId: string;
    groupJid: string;
    from: string;
    isHistorySync?: boolean;
  },
  sessionId?: string,
): MessageEvent {
  return {
    contractVersion: 1,
    type: "message",
    companyId,
    connectionId,
    timestamp: new Date().toISOString(),
    ...(sessionId ? { sessionId } : {}),
    payload: {
      messageId: overrides.messageId,
      from: overrides.from,
      to: overrides.groupJid,
      fromMe: false,
      content: "hello group",
      messageType: "text",
      timestamp: new Date().toISOString(),
      isGroup: true,
      groupId: overrides.groupJid,
      isHistorySync: overrides.isHistorySync === true,
    },
  };
}

async function storedMessage(
  companyId: string,
  messageId: string,
): Promise<{ sender_jid: string | null; sender_name: string | null }> {
  const tenantDb = getTenantConnection(companyId);
  return tenantDb
    .selectFrom("messages")
    .select(["sender_jid", "sender_name"])
    .where("message_id", "=", messageId)
    .executeTakeFirstOrThrow();
}

describe("handleMessageEvent - whatsmeow lookups keyed by worker session id", () => {
  integrationTest(
    "history sync resolves a group participant from a message secret stored under the session UUID",
    async () => {
      await withSessionTenant(
        async ({ companyId, connectionId, sessionId }) => {
          const groupJid = "120363000000000000@g.us";
          const participantJid = "15551110001@s.whatsapp.net";
          const messageId = crypto.randomUUID();

          // The worker wrote this row under CONNECTION_ID = session UUID.
          await sql`
          INSERT INTO whatsapp_sessions.whatsmeow_message_secrets (
            connection_id, our_jid, chat_jid, sender_jid, message_id, secret
          ) VALUES (
            ${sessionId}::uuid,
            ${OWN_JID},
            ${groupJid},
            ${participantJid},
            ${messageId},
            ${Buffer.from("test-secret")}
          )
        `.execute(db);
          await sql`
          INSERT INTO whatsapp_sessions.whatsmeow_contacts (
            connection_id, our_jid, their_jid, full_name
          ) VALUES (
            ${sessionId}::uuid,
            ${OWN_JID},
            ${participantJid},
            'Resolved By Session'
          )
        `.execute(db);

          // History-sync payload reports the group as `from`; the handler must
          // resolve the real participant from the worker's message-secret store.
          await handleMessageEvent(
            groupInboundEvent(
              companyId,
              connectionId,
              { messageId, groupJid, from: groupJid, isHistorySync: true },
              sessionId,
            ),
          );

          const message = await storedMessage(companyId, messageId);
          expect(message.sender_jid).toBe(participantJid);
          expect(message.sender_name).toBe("Resolved By Session");
        },
      );
    },
  );

  integrationTest(
    "history sync falls back to the durable connection id when the event carries no session id",
    async () => {
      await withSessionTenant(async ({ companyId, connectionId }) => {
        const groupJid = "120363000000000111@g.us";
        const participantJid = "15552220002@s.whatsapp.net";
        const messageId = crypto.randomUUID();

        // Legacy/pre-split accounts (and direct handler invocations) keep
        // whatsmeow rows under the durable connection id. The
        // `sessionId ?? connection.id` fallback must still resolve them.
        await sql`
          INSERT INTO whatsapp_sessions.whatsmeow_message_secrets (
            connection_id, our_jid, chat_jid, sender_jid, message_id, secret
          ) VALUES (
            ${connectionId}::uuid,
            ${OWN_JID},
            ${groupJid},
            ${participantJid},
            ${messageId},
            ${Buffer.from("test-secret")}
          )
        `.execute(db);
        await sql`
          INSERT INTO whatsapp_sessions.whatsmeow_contacts (
            connection_id, our_jid, their_jid, full_name
          ) VALUES (
            ${connectionId}::uuid,
            ${OWN_JID},
            ${participantJid},
            'Resolved By Connection'
          )
        `.execute(db);

        await handleMessageEvent(
          groupInboundEvent(
            companyId,
            connectionId,
            { messageId, groupJid, from: groupJid, isHistorySync: true },
            // No sessionId: legacy/direct invocation path.
          ),
        );

        const message = await storedMessage(companyId, messageId);
        expect(message.sender_jid).toBe(participantJid);
        expect(message.sender_name).toBe("Resolved By Connection");
      });
    },
  );

  integrationTest(
    "a live group message with no PushName names the sender from a whatsmeow contact stored under the session UUID",
    async () => {
      await withSessionTenant(
        async ({ companyId, connectionId, sessionId }) => {
          const groupJid = "120363000000000222@g.us";
          const participantJid = "15553330001@s.whatsapp.net";
          const messageId = crypto.randomUUID();

          // No durable contact row for the participant, and the live event
          // carries no PushName, so the only available name is the address-book
          // entry the worker stored under the session UUID. Before the fix this
          // read was keyed by connection.id and missed the row, degrading the
          // sender to the bare phone number.
          await sql`
          INSERT INTO whatsapp_sessions.whatsmeow_contacts (
            connection_id, our_jid, their_jid, full_name
          ) VALUES (
            ${sessionId}::uuid,
            ${OWN_JID},
            ${participantJid},
            'Address Book Name'
          )
        `.execute(db);

          await handleMessageEvent(
            groupInboundEvent(
              companyId,
              connectionId,
              { messageId, groupJid, from: participantJid },
              sessionId,
            ),
          );

          const message = await storedMessage(companyId, messageId);
          expect(message.sender_jid).toBe(participantJid);
          expect(message.sender_name).toBe("Address Book Name");
        },
      );
    },
  );

  integrationTest(
    "a live group message still prefers a durable custom name over the session-keyed whatsmeow contact",
    async () => {
      await withSessionTenant(
        async ({ companyId, connectionId, sessionId }) => {
          const groupJid = "120363000000000333@g.us";
          const participantJid = "15554440001@s.whatsapp.net";
          const messageId = crypto.randomUUID();

          // A human-renamed durable contact must still win over the worker's
          // address-book entry. This guards the composition order the fix relies
          // on (custom_name || push_name(durable) || full_name(whatsmeow) ...).
          const tenantDb = getTenantConnection(companyId);
          await tenantDb
            .insertInto("contacts")
            .values({
              whatsapp_connection_id: connectionId,
              jid: participantJid,
              phone_number: "15554440001",
              custom_name: "Durable Custom Name",
              is_group: false,
            })
            .execute();
          await sql`
          INSERT INTO whatsapp_sessions.whatsmeow_contacts (
            connection_id, our_jid, their_jid, full_name
          ) VALUES (
            ${sessionId}::uuid,
            ${OWN_JID},
            ${participantJid},
            'Should Not Win'
          )
        `.execute(db);

          await handleMessageEvent(
            groupInboundEvent(
              companyId,
              connectionId,
              { messageId, groupJid, from: participantJid },
              sessionId,
            ),
          );

          const message = await storedMessage(companyId, messageId);
          expect(message.sender_jid).toBe(participantJid);
          expect(message.sender_name).toBe("Durable Custom Name");
        },
      );
    },
  );
});
