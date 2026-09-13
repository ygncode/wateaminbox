import {
  parseTelegramThreadTarget,
  TelegramLocalFailureError,
  type TelegramOutboundContext,
  type TelegramOutboundTarget,
  type TelegramTransportPorts,
} from "@wateaminbox/adapter-telegram";
import {
  getPresignedUrl,
  resolveMediaKeyForCompany,
} from "../../../lib/storage.js";
import { readChannelCredential } from "../../../services/channel-credential.service.js";
import { getTenantConnection } from "../../../services/tenant.service.js";

/**
 * The application half of Telegram outbound sending.
 *
 * The adapter package holds no tenant database or media storage knowledge, so
 * the credential read, the conversation lookup, and media presigning are bound
 * here and injected into the transport by the registry.
 */
export const telegramTransportPorts: TelegramTransportPorts = {
  resolveOutboundContext,
  resolveAttachmentUrl,
};

async function resolveOutboundContext(
  target: TelegramOutboundTarget,
): Promise<TelegramOutboundContext> {
  const tenantDb = await getTenantConnection(target.companyId);
  const [token, conversation] = await Promise.all([
    readChannelCredential(
      tenantDb,
      target.companyId,
      target.channelAccountId,
      "telegram_bot_token",
    ),
    tenantDb
      .selectFrom("conversations as conversation")
      .innerJoin(
        "channel_accounts as account",
        "account.id",
        "conversation.channel_account_id",
      )
      .select([
        "conversation.external_thread_id",
        "account.status as account_status",
      ])
      .where("conversation.id", "=", target.conversationId)
      .where("conversation.channel_account_id", "=", target.channelAccountId)
      .where("conversation.archived_at", "is", null)
      .where("account.archived_at", "is", null)
      .executeTakeFirst(),
  ]);
  if (!token) {
    throw new TelegramLocalFailureError("telegram_credential_unavailable");
  }
  if (
    !conversation?.external_thread_id ||
    conversation.account_status !== "connected"
  ) {
    throw new TelegramLocalFailureError("telegram_conversation_unavailable");
  }
  const { chatId, messageThreadId } = parseTelegramThreadTarget(
    conversation.external_thread_id,
  );
  return {
    token,
    chatId,
    messageThreadId,
    externalThreadId: conversation.external_thread_id,
  };
}

async function resolveAttachmentUrl(
  companyId: string,
  attachment: Record<string, unknown> | undefined,
): Promise<string> {
  const storageUri =
    attachment && typeof attachment.storageUri === "string"
      ? attachment.storageUri
      : undefined;
  if (!storageUri) {
    throw new TelegramLocalFailureError("telegram_attachment_missing");
  }
  const key = resolveMediaKeyForCompany(storageUri, companyId);
  return getPresignedUrl(key, 10 * 60);
}
