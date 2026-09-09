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
} from "../../services/tenant.service.js";

const integration = process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

integration(
  "the channel conversation list is not buried by mirrored WhatsApp threads",
  async () => {
    const companyId = crypto.randomUUID();
    const schemaName = getSchemaName(companyId);
    const waAccount = crypto.randomUUID();
    const tgAccount = crypto.randomUUID();
    const telegramConversation = crypto.randomUUID();
    try {
      await db
        .insertInto("companies")
        .values({
          id: companyId,
          name: "Bridge filter test",
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
          id: waAccount,
          name: "MMPhone",
          phone_number: "60123456789",
          jid: "60123456789@s.whatsapp.net",
          status: "connected",
        })
        .execute();
      await tenantDb
        .insertInto("channel_accounts")
        .values([
          {
            id: waAccount,
            channel: "whatsapp",
            provider: "whatsapp_linked_device",
            display_name: "MMPhone",
            external_account_id: "60123456789@s.whatsapp.net",
            external_scope_id: waAccount,
            status: "connected",
            legacy_whatsapp_connection_id: waAccount,
          },
          {
            id: tgAccount,
            channel: "telegram",
            provider: "telegram_bot",
            display_name: "WATeamInbox",
            external_account_id: "bot-1",
            external_scope_id: "telegram-bot",
            status: "connected",
            legacy_whatsapp_connection_id: null,
          },
        ])
        .execute();

      // The shape that broke production: a pile of mirrored WhatsApp threads
      // and a couple of real Telegram ones. Ordered by recency the mirrors
      // won every slot, so the Telegram inbox rendered empty.
      const mirrors = Array.from({ length: 60 }, (_, index) => ({
        id: crypto.randomUUID(),
        channel_account_id: waAccount,
        external_thread_id: `6012345${index}@s.whatsapp.net`,
        client_thread_key: `legacy-contact:${index}`,
        kind: "direct" as const,
        last_message_at: new Date(Date.now() - index * 1000),
      }));
      await tenantDb.insertInto("conversations").values(mirrors).execute();
      await tenantDb
        .insertInto("conversations")
        .values({
          id: telegramConversation,
          channel_account_id: tgAccount,
          external_thread_id: "chat-10",
          client_thread_key: "telegram:chat-10:root",
          kind: "direct",
          last_message_at: new Date(Date.now() - 90_000),
        })
        .execute();

      // The list query's filter: mirrors are excluded, so the Telegram thread
      // is visible regardless of how many WhatsApp threads exist.
      const listed = await tenantDb
        .selectFrom("conversations as conversation")
        .innerJoin(
          "channel_accounts as account",
          "account.id",
          "conversation.channel_account_id",
        )
        .select(["conversation.id"])
        .where("conversation.archived_at", "is", null)
        .where("account.archived_at", "is", null)
        .where("account.legacy_whatsapp_connection_id", "is", null)
        .orderBy("conversation.last_message_at", "desc")
        .limit(50)
        .execute();

      expect(listed.map((row) => row.id)).toEqual([telegramConversation]);
    } finally {
      clearTenantConnection(companyId);
      await sql
        .raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
        .execute(db);
      await db.deleteFrom("companies").where("id", "=", companyId).execute();
    }
  },
  30_000,
);
