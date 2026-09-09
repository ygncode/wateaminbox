import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { DEFAULT_SLA_WEEKLY_SCHEDULE } from "@wateaminbox/shared";
import { sql } from "kysely";
import { dispatchChannelMessageDelivery } from "./channel-message-delivery.service.js";
import { insertNeutralOutboundSend } from "./channel-outbound.service.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "./tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

describe("insertNeutralOutboundSend", () => {
  integrationTest(
    "queues realtime fanout with the message so a sent message appears without a reload",
    async () => {
      const companyId = crypto.randomUUID();
      const schemaName = getSchemaName(companyId);
      const userId = crypto.randomUUID();
      try {
        await db
          .insertInto("users")
          .values({
            id: userId,
            email: `fanout-${userId}@example.com`,
            password_hash: "test",
          })
          .execute();
        await db
          .insertInto("companies")
          .values({
            id: companyId,
            name: "Outbound fanout test",
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
            created_by: userId,
          })
          .execute();
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);

        const accountId = crypto.randomUUID();
        await tenantDb
          .insertInto("channel_accounts")
          .values({
            id: accountId,
            channel: "telegram",
            provider: "telegram_bot",
            display_name: "Support bot",
            status: "connected",
          })
          .execute();
        const conversation = await tenantDb
          .insertInto("conversations")
          .values({
            channel_account_id: accountId,
            client_thread_key: `telegram:${crypto.randomUUID()}`,
            kind: "direct",
            subject: null,
            legacy_contact_id: null,
          })
          .returning("id")
          .executeTakeFirstOrThrow();

        const { messageId } = await tenantDb.transaction().execute((trx) =>
          insertNeutralOutboundSend(trx, {
            companyId,
            actorUserId: userId,
            contactId: null,
            conversationId: conversation.id,
            channelAccountId: accountId,
            content: "hello from the inbox",
            messageType: "text",
            caseId: null,
            idempotencyKey: crypto.randomUUID(),
          }),
        );

        const jobs = await sql<{ kind: string; message_id: string }>`
          SELECT kind, message_id FROM public.channel_message_delivery_outbox
          WHERE company_id = ${companyId}::uuid
        `.execute(db);
        // Exactly one realtime job, and no push: telling the sender about
        // their own message on their phone would be noise.
        expect(jobs.rows.map((row) => row.kind)).toEqual(["realtime"]);
        expect(jobs.rows[0]!.message_id).toBe(messageId);

        // The fanout row and the message commit together, so the delivery
        // worker can never claim a job whose message is not there yet.
        expect(
          await tenantDb
            .selectFrom("messages")
            .select("direction")
            .where("id", "=", messageId)
            .executeTakeFirst(),
        ).toEqual({ direction: "outbound" });

        // The worker has to be able to actually deliver it. A job that is
        // enqueued but always fails would leave the sender's thread just as
        // stale, only with a growing outbox behind it.
        expect(await dispatchChannelMessageDelivery("realtime")).toBe(1);
        const remaining = await sql<{ count: string }>`
          SELECT count(*)::text AS count
          FROM public.channel_message_delivery_outbox
          WHERE company_id = ${companyId}::uuid
        `.execute(db);
        expect(remaining.rows[0]!.count).toBe("0");
      } finally {
        await clearTenantConnection(companyId);
        await sql
          .raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
          .execute(db);
        await sql`DELETE FROM public.channel_message_delivery_outbox
          WHERE company_id = ${companyId}::uuid`.execute(db);
        await db
          .deleteFrom("sla_policies")
          .where("company_id", "=", companyId)
          .execute();
        await db.deleteFrom("companies").where("id", "=", companyId).execute();
        await db.deleteFrom("users").where("id", "=", userId).execute();
      }
    },
    120_000,
  );
});
