import { afterEach, describe, expect, test } from "bun:test";
import {
  db,
  reconcileChannelSpineConcurrentIndexes,
} from "@wateaminbox/database";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { formatMessageForConversation } from "../lib/message-formatters.js";
import { storeChannelCredential } from "./channel-credential.service.js";
import {
  dispatchNextChannelOutbound,
  initializeChannelOutbound,
  insertNeutralOutboundSend,
  shutdownChannelOutbound,
} from "./channel-outbound.service.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
  type TenantDatabase,
} from "./tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

const realFetch = globalThis.fetch;
const BOT_TOKEN = `1234567:${"A".repeat(35)}`;

/**
 * #381: a neutral-path send whose outcome is unknown must stop looking like it
 * is still sending. The legacy path's answer is the amber "unconfirmed" mark:
 * the message stays pending (it may have been delivered, so it is neither
 * retried nor failed) with metadata.error = send_outcome_unknown.
 */
async function withTelegramConversation(
  run: (ctx: {
    companyId: string;
    userId: string;
    accountId: string;
    conversationId: string;
    tenantDb: Kysely<TenantDatabase>;
  }) => Promise<void>,
): Promise<void> {
  const companyId = crypto.randomUUID();
  const schemaName = getSchemaName(companyId);
  const userId = crypto.randomUUID();
  const accountId = crypto.randomUUID();
  const conversationId = crypto.randomUUID();
  try {
    await db
      .insertInto("users")
      .values({
        id: userId,
        email: `outbound-uncertain-${userId}@example.com`,
        password_hash: "test",
      })
      .execute();
    await db
      .insertInto("companies")
      .values({
        id: companyId,
        name: "Outbound uncertain",
        schema_name: schemaName,
        status: "active",
      })
      .execute();
    await db
      .insertInto("company_members")
      .values({ user_id: userId, company_id: companyId, role: "owner" })
      .execute();
    await db
      .insertInto("channel_spine_workspace_flags")
      .values({
        company_id: companyId,
        write_authority: "neutral",
        write_authority_revision: "test",
        enabled_providers: sql<string[]>`ARRAY['telegram_bot']::text[]`,
        provider_enable_revision: "test",
        revision: "1",
        created_by: userId,
        updated_by: userId,
      })
      .execute();
    await createTenantSchema(companyId);
    await reconcileChannelSpineConcurrentIndexes(db, schemaName);
    const tenantDb = getTenantConnection(companyId);
    await tenantDb
      .insertInto("channel_accounts")
      .values({
        id: accountId,
        channel: "telegram",
        provider: "telegram_bot",
        display_name: "Bot",
        external_account_id: "1234567",
        external_scope_id: "telegram-bot",
        status: "connected",
      })
      .execute();
    await storeChannelCredential(
      tenantDb,
      companyId,
      accountId,
      "telegram_bot_token",
      BOT_TOKEN,
    );
    await tenantDb
      .insertInto("conversations")
      .values({
        id: conversationId,
        channel_account_id: accountId,
        external_thread_id: "987654321",
        client_thread_key: `telegram:${conversationId}`,
        kind: "direct",
        legacy_contact_id: null,
      })
      .execute();
    await run({ companyId, userId, accountId, conversationId, tenantDb });
  } finally {
    await clearTenantConnection(companyId);
    await sql`DELETE FROM public.channel_message_delivery_outbox
      WHERE company_id = ${companyId}`.execute(db);
    await sql.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).execute(db);
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
}

function queueSend(
  ctx: {
    companyId: string;
    userId: string;
    accountId: string;
    conversationId: string;
    tenantDb: Kysely<TenantDatabase>;
  },
  content: string,
) {
  return ctx.tenantDb.transaction().execute((trx) =>
    insertNeutralOutboundSend(trx, {
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      contactId: null,
      conversationId: ctx.conversationId,
      channelAccountId: ctx.accountId,
      content,
      messageType: "text",
      caseId: null,
      idempotencyKey: crypto.randomUUID(),
    }),
  );
}

async function readState(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
  messageId: string,
) {
  const intent = await tenantDb
    .selectFrom("outbound_message_intents")
    .select(["status", "last_error_code"])
    .where("message_id", "=", messageId)
    .executeTakeFirstOrThrow();
  const message = await tenantDb
    .selectFrom("messages")
    .selectAll()
    .where("id", "=", messageId)
    .executeTakeFirstOrThrow();
  const fanout = await sql<{ count: string }>`
    SELECT count(*)::text AS count FROM public.channel_message_delivery_outbox
    WHERE company_id = ${companyId} AND message_id = ${messageId}
      AND kind = 'realtime'`.execute(db);
  return { intent, message, fanouts: Number(fanout.rows[0]?.count ?? 0) };
}

describe("neutral outbound sends with an unknown outcome (#381)", () => {
  afterEach(async () => {
    globalThis.fetch = realFetch;
    await shutdownChannelOutbound();
  });

  integrationTest(
    "marks the message unconfirmed when the provider outcome is uncertain",
    async () => {
      await withTelegramConversation(async (ctx) => {
        const { messageId } = await queueSend(ctx, "did this arrive?");
        // A 5xx is not proof Telegram dropped the message, and it has no send
        // idempotency key, so the adapter reports the outcome as uncertain.
        globalThis.fetch = (async (
          input: RequestInfo | URL,
          init?: RequestInit,
        ) =>
          String(input).startsWith("https://api.telegram.org/")
            ? Response.json(
                { ok: false, error_code: 502, description: "Bad Gateway" },
                { status: 502 },
              )
            : realFetch(input, init)) as typeof fetch;
        await sql`DELETE FROM public.channel_message_delivery_outbox
          WHERE company_id = ${ctx.companyId}`.execute(db);

        expect(await dispatchNextChannelOutbound()).toBe(1);

        const { intent, message, fanouts } = await readState(
          ctx.tenantDb,
          ctx.companyId,
          messageId,
        );
        expect(intent).toEqual({
          status: "uncertain",
          last_error_code: "telegram_send_outcome_unknown",
        });
        // Still pending: it may have been delivered, so it must not be shown
        // as failed and invite a duplicate resend.
        expect(message.status).toBe("pending");
        expect(message.metadata).toMatchObject({
          error: "send_outcome_unknown",
          error_message: "telegram_send_outcome_unknown",
        });
        // The browser is told, rather than left spinning until a reload.
        expect(fanouts).toBe(1);
        // And a reload keeps the mark: the API hands the marker to the client.
        const formatted = formatMessageForConversation(
          message as never,
          new Map(),
          new Map(),
        );
        expect(formatted.status).toBe("pending");
        expect(formatted.metadata.error).toBe("send_outcome_unknown");
        // Nothing re-claims an uncertain intent.
        expect(await dispatchNextChannelOutbound()).toBe(0);
      });
    },
    60_000,
  );

  integrationTest(
    "marks the message unconfirmed when a dispatch lease expires, including after startup",
    async () => {
      await withTelegramConversation(async (ctx) => {
        const { messageId } = await queueSend(ctx, "lost in a restart");
        // A dispatcher that claimed the intent and then died: the lease is
        // set, the provider call may or may not have happened.
        await ctx.tenantDb
          .updateTable("outbound_message_intents")
          .set({
            status: "dispatching",
            lease_token: crypto.randomUUID(),
            lease_expires_at: new Date(Date.now() - 1_000),
          })
          .where("message_id", "=", messageId)
          .execute();
        await sql`DELETE FROM public.channel_message_delivery_outbox
          WHERE company_id = ${ctx.companyId}`.execute(db);
        // Never reached: an expired lease must not be retried either.
        globalThis.fetch = (async () => {
          throw new Error("an expired lease must not be re-sent");
        }) as unknown as typeof fetch;

        initializeChannelOutbound();
        const deadline = Date.now() + 10_000;
        let state = await readState(ctx.tenantDb, ctx.companyId, messageId);
        while (state.intent.status === "dispatching" && Date.now() < deadline) {
          await Bun.sleep(100);
          state = await readState(ctx.tenantDb, ctx.companyId, messageId);
        }
        await shutdownChannelOutbound();

        expect(state.intent).toEqual({
          status: "uncertain",
          last_error_code: "dispatch_lease_expired_outcome_unknown",
        });
        expect(state.message.status).toBe("pending");
        expect(state.message.metadata).toMatchObject({
          error: "send_outcome_unknown",
          error_message: "dispatch_lease_expired_outcome_unknown",
        });
        expect(state.fanouts).toBe(1);
      });
    },
    60_000,
  );

  integrationTest(
    "does not mark a message that a receipt already moved past pending",
    async () => {
      await withTelegramConversation(async (ctx) => {
        const { messageId } = await queueSend(ctx, "already delivered");
        await ctx.tenantDb
          .updateTable("outbound_message_intents")
          .set({
            status: "dispatching",
            lease_token: crypto.randomUUID(),
            lease_expires_at: new Date(Date.now() - 1_000),
          })
          .where("message_id", "=", messageId)
          .execute();
        await ctx.tenantDb
          .updateTable("messages")
          .set({ status: "delivered" })
          .where("id", "=", messageId)
          .execute();
        await sql`DELETE FROM public.channel_message_delivery_outbox
          WHERE company_id = ${ctx.companyId}`.execute(db);

        initializeChannelOutbound();
        const deadline = Date.now() + 10_000;
        let state = await readState(ctx.tenantDb, ctx.companyId, messageId);
        while (state.intent.status === "dispatching" && Date.now() < deadline) {
          await Bun.sleep(100);
          state = await readState(ctx.tenantDb, ctx.companyId, messageId);
        }
        await shutdownChannelOutbound();

        expect(state.intent.status).toBe("uncertain");
        expect(state.message.status).toBe("delivered");
        expect(state.message.metadata?.error).toBeUndefined();
        expect(state.fanouts).toBe(0);
      });
    },
    60_000,
  );
});
