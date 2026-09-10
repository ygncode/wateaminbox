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

/**
 * A Telegram conversation has no legacy contact, so its tags live on the
 * conversation. The chat list's tag filter is contact-scoped and never matched
 * one, which left every channel chat in the list whether or not it carried the
 * selected tag - the filter looked applied and simply did nothing.
 */
integration(
  "narrows channel conversations by the tags on the conversation",
  async () => {
    const companyId = crypto.randomUUID();
    const schemaName = getSchemaName(companyId);
    const account = crypto.randomUUID();
    const tagged = crypto.randomUUID();
    const untagged = crypto.randomUUID();
    const tagId = crypto.randomUUID();
    const otherTagId = crypto.randomUUID();
    try {
      await db
        .insertInto("companies")
        .values({
          id: companyId,
          name: "Tag filter test",
          schema_name: schemaName,
          status: "active",
        })
        .execute();
      await createTenantSchema(companyId);
      await reconcileChannelSpineConcurrentIndexes(db, schemaName);
      const tenantDb = await getTenantConnection(companyId);

      await tenantDb
        .insertInto("channel_accounts")
        .values({
          id: account,
          channel: "telegram",
          provider: "telegram_bot",
          display_name: "WATeamInbox",
          external_account_id: "bot-1",
          external_scope_id: "telegram-bot",
          status: "connected",
        })
        .execute();
      await tenantDb
        .insertInto("tags")
        .values([
          { id: tagId, name: "AI-Agent-Lead", color: "#8b5cf6" },
          { id: otherTagId, name: "Accounting & Tax", color: "#22c55e" },
        ])
        .execute();
      for (const [id, thread] of [
        [tagged, "chat-1"],
        [untagged, "chat-2"],
      ] as const) {
        await tenantDb
          .insertInto("conversations")
          .values({
            id,
            channel_account_id: account,
            external_thread_id: thread,
            client_thread_key: `telegram:${thread}:root`,
            kind: "direct",
            last_message_at: new Date(),
          })
          .execute();
      }
      await tenantDb
        .insertInto("conversation_tags")
        .values({ conversation_id: tagged, tag_id: tagId })
        .execute();

      const listedWith = async (ids: string[]) => {
        const rows = await tenantDb
          .selectFrom("conversations as conversation")
          .innerJoin(
            "channel_accounts as account",
            "account.id",
            "conversation.channel_account_id",
          )
          .select("conversation.id")
          .where("conversation.archived_at", "is", null)
          .where("account.archived_at", "is", null)
          .where("account.legacy_whatsapp_connection_id", "is", null)
          .$if(ids.length > 0, (qb) =>
            qb.where((eb) =>
              eb.exists(
                eb
                  .selectFrom("conversation_tags as link")
                  .select("link.tag_id")
                  .whereRef("link.conversation_id", "=", "conversation.id")
                  .where("link.tag_id", "in", ids),
              ),
            ),
          )
          .execute();
        return rows.map((row) => row.id).sort();
      };

      // No tag selected: both threads are listed.
      expect(await listedWith([])).toEqual([tagged, untagged].sort());
      // The selected tag narrows to the conversation that carries it.
      expect(await listedWith([tagId])).toEqual([tagged]);
      // A tag nothing carries returns nothing, rather than everything.
      expect(await listedWith([otherTagId])).toEqual([]);
      // Several tags match anything carrying any of them.
      expect(await listedWith([tagId, otherTagId])).toEqual([tagged]);
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
