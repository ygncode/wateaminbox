import { describe, expect, test } from "bun:test";
import {
  db,
  reconcileChannelSpineConcurrentIndexes,
} from "@wateaminbox/database";
import { DEFAULT_SLA_WEEKLY_SCHEDULE } from "@wateaminbox/shared";
import { sql } from "kysely";
import { purgeArchivedChannelAccount } from "./channel-account-purge.service.js";
import { openOrReopenCaseForInboundConversation } from "./conversation-case.service.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "./tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

describe("purgeArchivedChannelAccount", () => {
  integrationTest(
    "purges a Telegram account whose conversations have no contact",
    async () => {
      const companyId = crypto.randomUUID();
      const schemaName = getSchemaName(companyId);
      const ownerId = crypto.randomUUID();
      try {
        await db
          .insertInto("users")
          .values({
            id: ownerId,
            email: `channel-purge-${ownerId}@example.com`,
            password_hash: "test",
          })
          .execute();
        await db
          .insertInto("companies")
          .values({
            id: companyId,
            name: "Channel purge test",
            schema_name: schemaName,
            status: "active",
          })
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
        await reconcileChannelSpineConcurrentIndexes(db, schemaName);
        const tenantDb = getTenantConnection(companyId);
        const accountId = crypto.randomUUID();
        await tenantDb
          .insertInto("channel_accounts")
          .values({
            id: accountId,
            channel: "telegram",
            provider: "telegram_bot",
            display_name: "Bot",
            status: "archived",
            archived_at: new Date(),
          })
          .execute();
        const conversation = await tenantDb
          .insertInto("conversations")
          .values({
            channel_account_id: accountId,
            client_thread_key: `telegram:${crypto.randomUUID()}`,
            kind: "direct",
            subject: "Ada",
            legacy_contact_id: null,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        await tenantDb.transaction().execute(async (trx) => {
          const messageId = crypto.randomUUID();
          await trx
            .insertInto("messages")
            .values({
              id: messageId,
              contact_id: null,
              conversation_id: conversation.id,
              channel_account_id: accountId,
              from_me: false,
              message_type: "text",
              content: "hello",
              timestamp: new Date(),
            })
            .execute();
          await openOrReopenCaseForInboundConversation(
            trx,
            companyId,
            conversation.id,
            {
              contactId: null,
              isGroup: false,
              message: { id: messageId, timestamp: new Date() },
            },
          );
        });

        const result = await purgeArchivedChannelAccount(tenantDb, accountId);
        expect(result.contactIds).toEqual([]);
        expect(result.deletedMessageCount).toBe(1);
        expect(
          await tenantDb
            .selectFrom("channel_accounts")
            .select("id")
            .where("id", "=", accountId)
            .executeTakeFirst(),
        ).toBeUndefined();
        expect(
          await tenantDb
            .selectFrom("conversations")
            .select("id")
            .where("id", "=", conversation.id)
            .executeTakeFirst(),
        ).toBeUndefined();
        expect(
          Number(
            (
              await tenantDb
                .selectFrom("conversation_cases")
                .select((eb) => eb.fn.countAll<string>().as("count"))
                .executeTakeFirstOrThrow()
            ).count,
          ),
        ).toBe(0);
      } finally {
        await clearTenantConnection(companyId);
        await sql
          .raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
          .execute(db);
        await db
          .deleteFrom("sla_policies")
          .where("company_id", "=", companyId)
          .execute();
        await db.deleteFrom("companies").where("id", "=", companyId).execute();
        await db.deleteFrom("users").where("id", "=", ownerId).execute();
      }
    },
  );
});
