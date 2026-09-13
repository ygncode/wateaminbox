import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { TelegramLocalFailureError } from "@wateaminbox/adapter-telegram";
import { sql } from "kysely";
import {
  canStoreChannelCredentials,
  storeChannelCredential,
} from "../../../services/channel-credential.service.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "../../../services/tenant.service.js";
import { telegramTransportPorts } from "./ports.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" && canStoreChannelCredentials()
    ? test
    : test.skip;

const token = `12345:${"a".repeat(30)}`;

/**
 * The application half of the adapter's outbound port.
 *
 * Every refusal here has to arrive as a closed local failure code, because
 * those are the only outcomes the transport may classify permanent without
 * hearing from Telegram. Anything else degrades to "uncertain" and strands
 * the send instead of failing it.
 */
describe("telegramTransportPorts.resolveOutboundContext", () => {
  integrationTest(
    "resolves a bot's chat target and refuses every unsendable conversation by code",
    async () => {
      const companyId = crypto.randomUUID();
      const schemaName = getSchemaName(companyId);
      try {
        await db
          .insertInto("companies")
          .values({
            id: companyId,
            name: "Telegram ports test",
            schema_name: schemaName,
            status: "active",
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
        await storeChannelCredential(
          tenantDb,
          companyId,
          accountId,
          "telegram_bot_token",
          token,
        );

        const conversationId = async (externalThreadId: string | null) =>
          (
            await tenantDb
              .insertInto("conversations")
              .values({
                channel_account_id: accountId,
                client_thread_key: `telegram:${crypto.randomUUID()}`,
                external_thread_id: externalThreadId,
                kind: "direct",
                subject: null,
                legacy_contact_id: null,
              })
              .returning("id")
              .executeTakeFirstOrThrow()
          ).id;

        // A forum topic carries its thread id in the same column, and the Bot
        // API needs it split back out or the reply lands in the wrong topic.
        const topic = await conversationId("-1001234567890:thread:42");
        expect(
          await telegramTransportPorts.resolveOutboundContext({
            companyId,
            channelAccountId: accountId,
            conversationId: topic,
          }),
        ).toEqual({
          token,
          chatId: "-1001234567890",
          messageThreadId: 42,
          externalThreadId: "-1001234567890:thread:42",
        });

        const direct = await conversationId("987654321");
        const resolved = await telegramTransportPorts.resolveOutboundContext({
          companyId,
          channelAccountId: accountId,
          conversationId: direct,
        });
        expect(resolved.chatId).toBe("987654321");
        expect(resolved.messageThreadId).toBeUndefined();

        // A thread id the Bot API cannot address is a permanent refusal, not
        // an attempt against a chat id parsed out of a malformed string.
        const malformed = await conversationId("not-a-chat-id");
        expect(
          telegramTransportPorts.resolveOutboundContext({
            companyId,
            channelAccountId: accountId,
            conversationId: malformed,
          }),
        ).rejects.toThrow(
          new TelegramLocalFailureError("telegram_conversation_invalid"),
        );

        // A conversation the spine never gave an external thread has nowhere
        // to send, and so does one on an archived conversation.
        const unmapped = await conversationId(null);
        expect(
          telegramTransportPorts.resolveOutboundContext({
            companyId,
            channelAccountId: accountId,
            conversationId: unmapped,
          }),
        ).rejects.toThrow(
          new TelegramLocalFailureError("telegram_conversation_unavailable"),
        );
        await tenantDb
          .updateTable("conversations")
          .set({ archived_at: new Date() })
          .where("id", "=", direct)
          .execute();
        expect(
          telegramTransportPorts.resolveOutboundContext({
            companyId,
            channelAccountId: accountId,
            conversationId: direct,
          }),
        ).rejects.toThrow(
          new TelegramLocalFailureError("telegram_conversation_unavailable"),
        );

        // A paused bot still owns its conversations and its credential. Sending
        // through one anyway would reach Telegram over a webhook we revoked.
        await tenantDb
          .updateTable("channel_accounts")
          .set({ status: "disabled" })
          .where("id", "=", accountId)
          .execute();
        expect(
          telegramTransportPorts.resolveOutboundContext({
            companyId,
            channelAccountId: accountId,
            conversationId: topic,
          }),
        ).rejects.toThrow(
          new TelegramLocalFailureError("telegram_conversation_unavailable"),
        );
        await tenantDb
          .updateTable("channel_accounts")
          .set({ status: "connected" })
          .where("id", "=", accountId)
          .execute();

        // Another account's conversation is not reachable with this account's
        // token, even inside the same workspace.
        const otherAccountId = crypto.randomUUID();
        await tenantDb
          .insertInto("channel_accounts")
          .values({
            id: otherAccountId,
            channel: "telegram",
            provider: "telegram_bot",
            display_name: "Other bot",
            status: "connected",
          })
          .execute();
        await storeChannelCredential(
          tenantDb,
          companyId,
          otherAccountId,
          "telegram_bot_token",
          token,
        );
        expect(
          telegramTransportPorts.resolveOutboundContext({
            companyId,
            channelAccountId: otherAccountId,
            conversationId: topic,
          }),
        ).rejects.toThrow(
          new TelegramLocalFailureError("telegram_conversation_unavailable"),
        );

        // An account whose credential is gone reports exactly that, so the
        // operator is told to reconnect rather than shown a generic failure.
        await tenantDb
          .deleteFrom("channel_account_credentials")
          .where("channel_account_id", "=", accountId)
          .execute();
        expect(
          telegramTransportPorts.resolveOutboundContext({
            companyId,
            channelAccountId: accountId,
            conversationId: topic,
          }),
        ).rejects.toThrow(
          new TelegramLocalFailureError("telegram_credential_unavailable"),
        );
      } finally {
        await clearTenantConnection(companyId);
        await sql
          .raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
          .execute(db);
        await db.deleteFrom("companies").where("id", "=", companyId).execute();
      }
    },
    120_000,
  );
});
