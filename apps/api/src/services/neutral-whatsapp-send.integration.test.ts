import { expect, test } from "bun:test";
import {
  db,
  reconcileChannelSpineConcurrentIndexes,
} from "@wateaminbox/database";
import { sql } from "kysely";
import {
  dispatchNextChannelOutbound,
  insertNeutralOutboundSend,
} from "./channel-outbound.service.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "./tenant.service.js";

const integration = process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

/**
 * The path a WhatsApp message takes once `whatsapp_linked_device` is an
 * enabled provider: the route writes a message and an outbound intent, the
 * dispatcher claims the intent, and the linked-device adapter turns it into
 * the same NATS command the legacy path has always emitted.
 *
 * Nothing covered this before the cutover. The dispatcher had only ever been
 * exercised for Telegram, so the one thing the whole migration depends on -
 * that a WhatsApp send still reaches the worker - rested on reading the code.
 */
integration(
  "dispatches a neutral WhatsApp send to the worker as a NATS command",
  async () => {
    const companyId = crypto.randomUUID();
    const schemaName = getSchemaName(companyId);
    const userId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();
    const contactId = crypto.randomUUID();
    try {
      await db
        .insertInto("users")
        .values({
          id: userId,
          email: `neutral-send-${userId}@example.com`,
          password_hash: "test",
        })
        .execute();
      await db
        .insertInto("companies")
        .values({
          id: companyId,
          name: "Neutral WhatsApp send",
          schema_name: schemaName,
          status: "active",
        })
        .execute();
      // The dispatcher re-checks that the sender may still send before it
      // hands anything to a provider, so the actor has to be a real member.
      await db
        .insertInto("company_members")
        .values({ user_id: userId, company_id: companyId, role: "owner" })
        .execute();
      // The flip: WhatsApp is an enabled provider with neutral authority.
      await db
        .insertInto("channel_spine_workspace_flags")
        .values({
          company_id: companyId,
          dual_write_enabled: true,
          dual_write_revision: "test",
          shadow_normalization_enabled: true,
          shadow_normalization_revision: "test",
          neutral_reads_enabled: true,
          neutral_read_revision: "test",
          write_authority: "neutral",
          write_authority_revision: "test",
          enabled_providers: sql<
            string[]
          >`ARRAY['telegram_bot','whatsapp_linked_device']::text[]`,
          provider_enable_revision: "test",
          revision: "1",
          created_by: userId,
          updated_by: userId,
        })
        .execute();
      await createTenantSchema(companyId);
      await reconcileChannelSpineConcurrentIndexes(db, schemaName);
      const tenantDb = await getTenantConnection(companyId);

      await tenantDb
        .insertInto("whatsapp_connections")
        .values({
          id: connectionId,
          name: "MMPhone",
          phone_number: "60123456789",
          jid: "60123456789@s.whatsapp.net",
          status: "connected",
        })
        .execute();
      await tenantDb
        .insertInto("whatsapp_connection_sessions")
        .values({
          whatsapp_connection_id: connectionId,
          status: "connected",
        })
        .execute();
      await tenantDb
        .insertInto("contacts")
        .values({
          id: contactId,
          whatsapp_connection_id: connectionId,
          jid: "60129999999@s.whatsapp.net",
          phone_number: "60129999999",
          push_name: "Ada",
        })
        .execute();
      // The bridge the backfill builds: account and conversation share the
      // connection's and the contact's ids.
      await tenantDb
        .insertInto("channel_accounts")
        .values({
          id: connectionId,
          channel: "whatsapp",
          provider: "whatsapp_linked_device",
          display_name: "MMPhone",
          external_account_id: "60123456789@s.whatsapp.net",
          external_scope_id: connectionId,
          // Deliberately stale. In production a phone reconnected at 00:25
          // while the mirror still read "disconnected" from 19:48, because the
          // mirror only refreshes when a message flows through the bridge.
          // Both send guards used to read this column, so that workspace could
          // not send at all while its WhatsApp was in fact online.
          status: "disconnected",
          legacy_whatsapp_connection_id: connectionId,
        })
        .execute();
      await tenantDb
        .insertInto("conversations")
        .values({
          id: contactId,
          channel_account_id: connectionId,
          external_thread_id: "60129999999@s.whatsapp.net",
          client_thread_key: `legacy-contact:${contactId}`,
          kind: "direct",
          legacy_contact_id: contactId,
        })
        .execute();

      const { messageId } = await tenantDb.transaction().execute((trx) =>
        insertNeutralOutboundSend(trx, {
          companyId,
          actorUserId: userId,
          contactId,
          conversationId: contactId,
          channelAccountId: connectionId,
          content: "hello from the neutral path",
          messageType: "text",
          caseId: null,
          // Album membership rides on the same intent. Dispatching a real
          // album needs a resolvable media object, which this fixture has no
          // way to provide, so the album's own coverage is the metadata write
          // below and the transport's parser test.
          mediaAlbum: {
            id: "album-1",
            index: 0,
            count: 2,
            imageCount: 2,
            videoCount: 0,
          },
          idempotencyKey: crypto.randomUUID(),
        }),
      );

      // The dispatcher must claim it: this is where `enabled_providers` is
      // consulted, and where a WhatsApp intent would silently sit for ever if
      // the flip had not taken. It must also look past the stale mirror above
      // to the connection itself, which says the phone is online.
      expect(await dispatchNextChannelOutbound()).toBe(1);

      const intent = await tenantDb
        .selectFrom("outbound_message_intents")
        .select(["status", "last_error_code"])
        .where("message_id", "=", messageId)
        .executeTakeFirstOrThrow();
      expect(intent.last_error_code).toBeNull();
      expect(["handed_off", "confirmed"]).toContain(intent.status);

      // And the worker has to actually be told. The adapter emits the same
      // send command the legacy path always did, so the message reaches
      // WhatsApp by the route that has always worked.
      const command = await tenantDb
        .selectFrom("nats_outbox")
        .select(["subject", "payload"])
        .executeTakeFirstOrThrow();
      expect(command.subject).toContain(companyId);
      const payload = command.payload as Record<string, unknown>;
      expect(payload.type ?? payload.command).toBeTruthy();
      expect(JSON.stringify(payload)).toContain("60129999999@s.whatsapp.net");
      expect(JSON.stringify(payload)).toContain("hello from the neutral path");

      // The message is stitched back onto its legacy identity so the existing
      // inbox, receipts, and reconciliation keep working unchanged.
      const message = await tenantDb
        .selectFrom("messages")
        .select(["whatsapp_connection_id", "contact_id", "message_id"])
        .where("id", "=", messageId)
        .executeTakeFirstOrThrow();
      expect(message.whatsapp_connection_id).toBe(connectionId);
      expect(message.contact_id).toBe(contactId);
      expect(message.message_id).toBe(`pending_${messageId}`);

      // The inbox lays album tiles out from message metadata, so a child that
      // loses this renders as a loose photo beside the album it belongs to.
      const stored = await tenantDb
        .selectFrom("messages")
        .select("metadata")
        .where("id", "=", messageId)
        .executeTakeFirstOrThrow();
      expect(stored.metadata).toMatchObject({
        mediaAlbumId: "album-1",
        mediaAlbumIndex: 0,
        mediaAlbumCount: 2,
      });
    } finally {
      clearTenantConnection(companyId);
      await sql
        .raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
        .execute(db);
      await db
        .deleteFrom("channel_spine_workspace_flags")
        .where("company_id", "=", companyId)
        .execute();
      await db
        .deleteFrom("company_members")
        .where("company_id", "=", companyId)
        .execute();
      await db.deleteFrom("companies").where("id", "=", companyId).execute();
      await db.deleteFrom("users").where("id", "=", userId).execute();
    }
  },
  60_000,
);
