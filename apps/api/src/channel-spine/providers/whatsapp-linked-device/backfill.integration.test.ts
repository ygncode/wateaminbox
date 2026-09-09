import { expect, test } from "bun:test";
import {
  db,
  reconcileChannelSpineConcurrentIndexes,
} from "@wateaminbox/database";
import { sql } from "kysely";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "../../../services/tenant.service.js";
import { backfillLinkedDeviceTenant } from "./backfill.js";

const integration = process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

integration(
  "backfills linked-device history without blocking on another provider's rows",
  async () => {
    const companyId = crypto.randomUUID();
    const schemaName = getSchemaName(companyId);
    const connectionId = crypto.randomUUID();
    const telegramAccountId = crypto.randomUUID();
    const waContactId = crypto.randomUUID();
    const waMessageId = crypto.randomUUID();
    const telegramMessageId = crypto.randomUUID();
    const telegramConversationId = crypto.randomUUID();
    try {
      await db
        .insertInto("companies")
        .values({
          id: companyId,
          name: "Backfill scope test",
          schema_name: schemaName,
          status: "active",
        })
        .execute();
      await createTenantSchema(companyId);
      await reconcileChannelSpineConcurrentIndexes(db, schemaName);
      const tenantDb = await getTenantConnection(companyId);

      await tenantDb
        .insertInto("whatsapp_connections")
        .values({
          id: connectionId,
          name: "Line",
          phone_number: "60123456789",
          jid: "60123456789@s.whatsapp.net",
          status: "connected",
        })
        .execute();
      await tenantDb
        .insertInto("contacts")
        .values({
          id: waContactId,
          whatsapp_connection_id: connectionId,
          jid: "60129999999@s.whatsapp.net",
          phone_number: "60129999999",
        })
        .execute();
      await tenantDb
        .insertInto("messages")
        .values({
          id: waMessageId,
          whatsapp_connection_id: connectionId,
          contact_id: waContactId,
          message_id: "3EBHISTORY",
          from_me: false,
          message_type: "text",
          content: "old history",
          timestamp: new Date("2026-01-01T12:00:00Z"),
        })
        .execute();

      // A Telegram message: no WhatsApp connection and no legacy contact. It
      // already has its own neutral rows and is not this backfill's to touch.
      // Before scoping, bridging it failed, counted as a blocked row, and
      // aborted the entire sweep.
      await tenantDb
        .insertInto("channel_accounts")
        .values({
          id: telegramAccountId,
          channel: "telegram",
          provider: "telegram_bot",
          display_name: "Bot",
          external_account_id: "bot-1",
          external_scope_id: "telegram",
          status: "connected",
        })
        .execute();
      await tenantDb
        .insertInto("conversations")
        .values({
          id: telegramConversationId,
          channel_account_id: telegramAccountId,
          external_thread_id: "chat-10",
          client_thread_key: "telegram:chat-10:root",
          kind: "direct",
        })
        .execute();
      await tenantDb
        .insertInto("messages")
        .values({
          id: telegramMessageId,
          whatsapp_connection_id: null,
          contact_id: null,
          conversation_id: telegramConversationId,
          channel_account_id: telegramAccountId,
          message_id: null,
          from_me: false,
          message_type: "text",
          content: "telegram message",
          timestamp: new Date("2026-01-02T12:00:00Z"),
        })
        .execute();

      const result = await backfillLinkedDeviceTenant(tenantDb, companyId, 50);
      expect(result.blockedRows).toBe(0);
      expect(result.messagesProcessed).toBe(1);
      expect(result.contactsProcessed).toBe(1);
      expect(result.accountsProcessed).toBe(1);

      // The WhatsApp history is on the spine.
      expect(
        (
          await tenantDb
            .selectFrom("messages")
            .select("conversation_id")
            .where("id", "=", waMessageId)
            .executeTakeFirstOrThrow()
        ).conversation_id,
      ).toBe(waContactId);
      // The Telegram message was left exactly as it was.
      expect(
        (
          await tenantDb
            .selectFrom("messages")
            .select(["conversation_id", "channel_account_id"])
            .where("id", "=", telegramMessageId)
            .executeTakeFirstOrThrow()
        ).channel_account_id,
      ).toBe(telegramAccountId);
      expect(
        Number(
          (
            await tenantDb
              .selectFrom("channel_spine_reconciliation_journal")
              .select((eb) => eb.fn.countAll<string>().as("count"))
              .executeTakeFirstOrThrow()
          ).count,
        ),
      ).toBe(0);

      // Idempotent: a second sweep resumes from its checkpoints and repeats
      // nothing, which is what makes an interrupted run safe to re-run.
      const again = await backfillLinkedDeviceTenant(tenantDb, companyId, 50);
      expect(again.blockedRows).toBe(0);
    } finally {
      clearTenantConnection(companyId);
      await sql
        .raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
        .execute(db);
      await db.deleteFrom("companies").where("id", "=", companyId).execute();
    }
  },
  60_000,
);
