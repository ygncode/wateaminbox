import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { DEFAULT_SLA_WEEKLY_SCHEDULE } from "@wateaminbox/shared";
import { sql } from "kysely";
import type { MessageDbRow } from "../../lib/message-formatters.js";
import type { MessageEvent } from "../../lib/nats/types/events.js";
import {
  buildSnapshotQuote,
  loadSnapshotSenders,
} from "../../lib/quoted-snapshots.js";
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
        name: "Quoted snapshot test",
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
        name: "Quoted snapshot test",
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

const GROUP_JID = "120363000000000002@g.us";
const ANGELA = "15551110003@s.whatsapp.net";
const SOPHIE = "15551110004@s.whatsapp.net";

function replyEvent(
  companyId: string,
  connectionId: string,
  sessionId: string,
  messageId: string,
  quotedMessage?: Record<string, unknown>,
): MessageEvent {
  const event = groupInboundEvent(
    companyId,
    connectionId,
    { messageId, groupJid: GROUP_JID, from: ANGELA },
    sessionId,
  );
  return {
    ...event,
    payload: {
      ...event.payload,
      content: "Everyone looking good!",
      quotedMessageId: "3A62CC70343D56565D7C",
      ...(quotedMessage ? { quotedMessage } : {}),
    } as MessageEvent["payload"],
  };
}

describe("quoted message snapshot", () => {
  integrationTest(
    "a reply keeps WhatsApp's copy of an unsynced original and shows it with the sender's name",
    async () => {
      await withSessionTenant(
        async ({ companyId, connectionId, sessionId }) => {
          const tenantDb = getTenantConnection(companyId);
          await tenantDb
            .insertInto("contacts")
            .values({
              id: crypto.randomUUID(),
              whatsapp_connection_id: connectionId,
              jid: SOPHIE,
              phone_number: "15551110004",
              push_name: "Sophie Vu",
              is_group: false,
            })
            .execute();

          const messageId = crypto.randomUUID();
          await handleMessageEvent(
            replyEvent(companyId, connectionId, sessionId, messageId, {
              senderJid: SOPHIE,
              messageType: "text",
              content: "  Thank you Magda. Miss you....  ",
            }),
          );
          const row = (await tenantDb
            .selectFrom("messages")
            .selectAll()
            .where("message_id", "=", messageId)
            .executeTakeFirstOrThrow()) as unknown as MessageDbRow;
          expect(row.metadata?.quotedSnapshot).toEqual({
            senderJid: SOPHIE,
            messageType: "text",
            content: "Thank you Magda. Miss you....",
          });

          const quote = buildSnapshotQuote(
            row,
            await loadSnapshotSenders(tenantDb, [row]),
          );
          expect(quote).toMatchObject({
            id: "3A62CC70343D56565D7C",
            isSnapshot: true,
            senderType: "contact",
            senderName: "Sophie Vu",
            messageType: "text",
            content: "Thank you Magda. Miss you....",
          });
        },
      );
    },
  );

  integrationTest(
    "drops a malformed or unknown-type copy and keeps the reply",
    async () => {
      await withSessionTenant(
        async ({ companyId, connectionId, sessionId }) => {
          const tenantDb = getTenantConnection(companyId);
          const ids = [crypto.randomUUID(), crypto.randomUUID()];
          await handleMessageEvent(
            replyEvent(companyId, connectionId, sessionId, ids[0]!, {
              senderJid: "not a jid",
              messageType: "poll",
              content: "x",
            }),
          );
          await handleMessageEvent(
            replyEvent(companyId, connectionId, sessionId, ids[1]!, {
              senderJid: "<script>@evil.example",
              messageType: "text",
              content: "y".repeat(5_000),
            }),
          );
          const rows = await tenantDb
            .selectFrom("messages")
            .select(["message_id", "metadata"])
            .where("message_id", "in", ids)
            .execute();
          const byId = new Map(rows.map((r) => [r.message_id, r.metadata]));
          expect(
            (byId.get(ids[0]!) as Record<string, unknown> | null)
              ?.quotedSnapshot,
          ).toBeUndefined();
          const kept = (byId.get(ids[1]!) as Record<string, unknown>)
            .quotedSnapshot as Record<string, unknown>;
          expect(kept.senderJid).toBeUndefined();
          expect((kept.content as string).length).toBe(1024);
        },
      );
    },
  );
});
