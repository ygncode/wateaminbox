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

async function provisionTenant(label: string) {
  const companyId = crypto.randomUUID();
  const schemaName = getSchemaName(companyId);
  const ownerId = crypto.randomUUID();
  await db
    .insertInto("users")
    .values({
      id: ownerId,
      email: `${label}-${ownerId}@example.com`,
      password_hash: "test",
    })
    .execute();
  await db
    .insertInto("companies")
    .values({
      id: companyId,
      name: `${label} test`,
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
  return { companyId, schemaName, ownerId, tenantDb };
}

async function teardownTenant(
  companyId: string,
  schemaName: string,
  ownerId: string,
) {
  await clearTenantConnection(companyId);
  await sql.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).execute(db);
  await db
    .deleteFrom("sla_policies")
    .where("company_id", "=", companyId)
    .execute();
  await db.deleteFrom("companies").where("id", "=", companyId).execute();
  await db.deleteFrom("users").where("id", "=", ownerId).execute();
}

async function createArchivedTelegramAccount(
  tenantDb: ReturnType<typeof getTenantConnection>,
  accountId: string,
) {
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
}

async function reactionCountByAccount(
  tenantDb: ReturnType<typeof getTenantConnection>,
  accountId: string,
) {
  return Number(
    (
      await tenantDb
        .selectFrom("message_reactions")
        .select((eb) => eb.fn.countAll<string>().as("count"))
        .where("channel_account_id", "=", accountId)
        .executeTakeFirstOrThrow()
    ).count,
  );
}

describe("purgeArchivedChannelAccount", () => {
  integrationTest(
    "purges an archived Telegram account along with its reactions",
    async () => {
      const { companyId, schemaName, ownerId, tenantDb } =
        await provisionTenant("channel-purge");
      try {
        const accountId = crypto.randomUUID();
        await createArchivedTelegramAccount(tenantDb, accountId);
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
        const messageId = crypto.randomUUID();
        const reactionId = crypto.randomUUID();
        await tenantDb.transaction().execute(async (trx) => {
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
          await trx
            .insertInto("message_reactions")
            .values({
              id: reactionId,
              message_id: messageId,
              reactor_jid: `telegram:${crypto.randomUUID()}`,
              emoji: "👍",
              channel_account_id: accountId,
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
          await tenantDb
            .selectFrom("message_reactions")
            .select("id")
            .where("id", "=", reactionId)
            .executeTakeFirst(),
        ).toBeUndefined();
        expect(await reactionCountByAccount(tenantDb, accountId)).toBe(0);
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
        await teardownTenant(companyId, schemaName, ownerId);
      }
    },
  );

  integrationTest(
    "reaps orphaned reactions whose message row was already deleted",
    async () => {
      const { companyId, schemaName, ownerId, tenantDb } =
        await provisionTenant("channel-purge-orphan");
      try {
        const accountId = crypto.randomUUID();
        await createArchivedTelegramAccount(tenantDb, accountId);
        const conversation = await tenantDb
          .insertInto("conversations")
          .values({
            channel_account_id: accountId,
            client_thread_key: `telegram:${crypto.randomUUID()}`,
            kind: "direct",
            subject: "Orphan",
            legacy_contact_id: null,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        const realMessageId = crypto.randomUUID();
        await tenantDb
          .insertInto("messages")
          .values({
            id: realMessageId,
            contact_id: null,
            conversation_id: conversation.id,
            channel_account_id: accountId,
            from_me: false,
            message_type: "text",
            content: "hello",
            timestamp: new Date(),
          })
          .execute();
        const orphanedReactionId = crypto.randomUUID();
        await tenantDb
          .insertInto("message_reactions")
          .values({
            id: orphanedReactionId,
            message_id: crypto.randomUUID(),
            reactor_jid: `telegram:${crypto.randomUUID()}`,
            emoji: "❤️",
            channel_account_id: accountId,
          })
          .execute();

        const result = await purgeArchivedChannelAccount(tenantDb, accountId);
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
            .selectFrom("message_reactions")
            .select("id")
            .where("id", "=", orphanedReactionId)
            .executeTakeFirst(),
        ).toBeUndefined();
        expect(await reactionCountByAccount(tenantDb, accountId)).toBe(0);
      } finally {
        await teardownTenant(companyId, schemaName, ownerId);
      }
    },
  );
});
