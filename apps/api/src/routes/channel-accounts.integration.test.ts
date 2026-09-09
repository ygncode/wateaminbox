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
} from "../services/tenant.service.js";

const integration = process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

/**
 * This mirrors the route's WHERE clause rather than calling the handler, so it
 * pins the intended data shape rather than the route itself: it would not
 * catch the filter being deleted from the route. The user-visible behaviour -
 * that a mirrored WhatsApp account never becomes a second picker entry - is
 * covered by the ChatList selector test instead.
 */
async function listedAccountIds(companyId: string): Promise<string[]> {
  const tenantDb = await getTenantConnection(companyId);
  const rows = await tenantDb
    .selectFrom("channel_accounts")
    .select(["id"])
    .where("archived_at", "is", null)
    .where("legacy_whatsapp_connection_id", "is", null)
    .orderBy("created_at", "asc")
    .execute();
  return rows.map((row) => row.id);
}

integration(
  "does not list the spine's mirror of a WhatsApp connection as a separate account",
  async () => {
    const companyId = crypto.randomUUID();
    const schemaName = getSchemaName(companyId);
    const connectionId = crypto.randomUUID();
    const telegramId = crypto.randomUUID();
    try {
      await db
        .insertInto("companies")
        .values({
          id: companyId,
          name: "Account listing test",
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
          name: "WATeamInbox-TH",
          phone_number: "60123456789",
          jid: "60123456789@s.whatsapp.net",
          status: "connected",
        })
        .execute();
      await tenantDb
        .insertInto("channel_accounts")
        .values([
          {
            // The bridge: same identity as the connection above. The
            // connections API already returns this account, so listing it
            // here too showed the number twice in every account picker.
            id: connectionId,
            channel: "whatsapp",
            provider: "whatsapp_linked_device",
            display_name: "WATeamInbox-TH",
            external_account_id: "60123456789@s.whatsapp.net",
            external_scope_id: connectionId,
            status: "connected",
            legacy_whatsapp_connection_id: connectionId,
          },
          {
            id: telegramId,
            channel: "telegram",
            provider: "telegram_bot",
            display_name: "SKFinace",
            external_account_id: "bot-1",
            external_scope_id: "telegram-bot",
            status: "connected",
            legacy_whatsapp_connection_id: null,
          },
        ])
        .execute();

      // Only the Telegram bot is a channel account in its own right.
      expect(await listedAccountIds(companyId)).toEqual([telegramId]);
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
