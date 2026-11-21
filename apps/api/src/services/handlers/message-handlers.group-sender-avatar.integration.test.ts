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
import { hydrateGroupSenderAvatars } from "../../lib/group-sender-avatars.js";
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
        name: "Group sender avatar test",
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
        name: "Group sender avatar test",
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

const GROUP_JID = "120363000000000001@g.us";
const MAI_JID = "15551110002@s.whatsapp.net";
const MAI_AVATAR = "s3://whatsapp-media/avatars/mai.jpg";

async function avatarOf(companyId: string, messageId: string) {
  const row = await getTenantConnection(companyId)
    .selectFrom("messages")
    .select("sender_avatar_url")
    .where("message_id", "=", messageId)
    .executeTakeFirstOrThrow();
  return row.sender_avatar_url;
}

async function setMaiAvatarOnExistingMessages(companyId: string) {
  // What the profile-picture event does: it updates only the rows present now.
  await getTenantConnection(companyId)
    .updateTable("messages")
    .set({ sender_avatar_url: MAI_AVATAR })
    .where("sender_jid", "=", MAI_JID)
    .execute();
}

describe("group participant avatars", () => {
  integrationTest(
    "a later message from a participant reuses the avatar an earlier message received",
    async () => {
      await withSessionTenant(
        async ({ companyId, connectionId, sessionId }) => {
          const first = crypto.randomUUID();
          await handleMessageEvent(
            groupInboundEvent(
              companyId,
              connectionId,
              { messageId: first, groupJid: GROUP_JID, from: MAI_JID },
              sessionId,
            ),
          );
          await setMaiAvatarOnExistingMessages(companyId);

          const second = crypto.randomUUID();
          await handleMessageEvent(
            groupInboundEvent(
              companyId,
              connectionId,
              { messageId: second, groupJid: GROUP_JID, from: MAI_JID },
              sessionId,
            ),
          );

          expect(await avatarOf(companyId, first)).toBe(MAI_AVATAR);
          expect(await avatarOf(companyId, second)).toBe(MAI_AVATAR);
        },
      );
    },
  );

  integrationTest(
    "a new message prefers the participant's own contact picture",
    async () => {
      await withSessionTenant(
        async ({ companyId, connectionId, sessionId }) => {
          const contactAvatar = "s3://whatsapp-media/avatars/mai-contact.jpg";
          await getTenantConnection(companyId)
            .insertInto("contacts")
            .values({
              id: crypto.randomUUID(),
              whatsapp_connection_id: connectionId,
              jid: MAI_JID,
              phone_number: "15551110002",
              profile_picture_url: contactAvatar,
              is_group: false,
            })
            .execute();

          const messageId = crypto.randomUUID();
          await handleMessageEvent(
            groupInboundEvent(
              companyId,
              connectionId,
              { messageId, groupJid: GROUP_JID, from: MAI_JID },
              sessionId,
            ),
          );

          expect(await avatarOf(companyId, messageId)).toBe(contactAvatar);
        },
      );
    },
  );

  integrationTest(
    "reads fill rows stored without an avatar but never overwrite one",
    async () => {
      await withSessionTenant(
        async ({ companyId, connectionId, sessionId }) => {
          const ids = [crypto.randomUUID(), crypto.randomUUID()];
          for (const messageId of ids) {
            await handleMessageEvent(
              groupInboundEvent(
                companyId,
                connectionId,
                { messageId, groupJid: GROUP_JID, from: MAI_JID },
                sessionId,
              ),
            );
          }
          const tenantDb = getTenantConnection(companyId);
          // Only the first row received the picture (the reported bug).
          await tenantDb
            .updateTable("messages")
            .set({ sender_avatar_url: MAI_AVATAR })
            .where("message_id", "=", ids[0]!)
            .execute();
          const rows = await tenantDb
            .selectFrom("messages")
            .selectAll()
            .where("message_id", "in", ids)
            .execute();
          const ownStale = {
            ...rows[0]!,
            sender_avatar_url: "s3://whatsapp-media/avatars/kept.jpg",
          };

          const hydrated = await hydrateGroupSenderAvatars(tenantDb, [
            ...rows,
            ownStale,
          ]);

          expect(
            hydrated.slice(0, 2).map((row) => row.sender_avatar_url),
          ).toEqual([MAI_AVATAR, MAI_AVATAR]);
          expect(hydrated[2]!.sender_avatar_url).toBe(
            "s3://whatsapp-media/avatars/kept.jpg",
          );
        },
      );
    },
  );
});
