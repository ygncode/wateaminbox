import type {
  ChannelActionIntent,
  OutboundMessageIntent,
  ProviderActionResult,
  ProviderSendResult,
} from "@wateaminbox/shared";
import {
  getPresignedUrl,
  resolveMediaKeyForCompany,
} from "../../../lib/storage.js";
import { readChannelCredential } from "../../../services/channel-credential.service.js";
import { getTenantConnection } from "../../../services/tenant.service.js";
import type { TelegramBotOutboundTransport } from "./adapter.js";
import { telegramBotRequest } from "./api.js";

interface TelegramMessageResult {
  message_id: number;
}

export class TelegramBotApiTransport implements TelegramBotOutboundTransport {
  async send(intent: OutboundMessageIntent): Promise<ProviderSendResult> {
    try {
      const context = await resolveContext(intent);
      const payload = intent.normalizedPayload;
      const messageType = stringValue(payload.messageType) ?? "text";
      const text = stringValue(payload.textContent) ?? "";
      const attachment = firstAttachment(payload.attachments);
      const request: Record<string, unknown> = {
        chat_id: context.chatId,
        message_thread_id: context.messageThreadId,
        reply_parameters: optionalReply(payload.replyToExternalMessageId),
      };
      let method: string;
      switch (messageType) {
        case "text":
          method = "sendMessage";
          request.text = text;
          break;
        case "image":
          method = "sendPhoto";
          request.photo = await attachmentUrl(intent.companyId, attachment);
          request.caption = text || undefined;
          break;
        case "video":
          method = "sendVideo";
          request.video = await attachmentUrl(intent.companyId, attachment);
          request.caption = text || undefined;
          break;
        case "audio":
          method = "sendAudio";
          request.audio = await attachmentUrl(intent.companyId, attachment);
          request.caption = text || undefined;
          break;
        case "voice":
          method = "sendVoice";
          request.voice = await attachmentUrl(intent.companyId, attachment);
          request.caption = text || undefined;
          break;
        case "document":
          method = "sendDocument";
          request.document = await attachmentUrl(intent.companyId, attachment);
          request.caption = text || undefined;
          break;
        default:
          return {
            outcome: "permanent_failure",
            errorCode: "telegram_message_type_unsupported",
          };
      }
      const result = await telegramBotRequest<TelegramMessageResult>(
        context.token,
        method,
        request,
      );
      return {
        outcome: "confirmed",
        externalMessageId: String(result.message_id),
        externalIdentityScope: `telegram-thread:${context.externalThreadId}`,
      };
    } catch (error) {
      return providerFailure(error);
    }
  }

  async perform(action: ChannelActionIntent): Promise<ProviderActionResult> {
    try {
      const context = await resolveContext(action);
      const messageId = numberValue(action.payload.externalMessageId);
      if (!messageId) {
        return {
          outcome: "permanent_failure",
          errorCode: "telegram_message_id_missing",
        };
      }
      switch (action.operation) {
        case "delete":
          await telegramBotRequest(context.token, "deleteMessage", {
            chat_id: context.chatId,
            message_id: messageId,
          });
          break;
        case "edit":
          await telegramBotRequest(context.token, "editMessageText", {
            chat_id: context.chatId,
            message_id: messageId,
            text: stringValue(action.payload.textContent) ?? "",
          });
          break;
        case "reaction":
          await telegramBotRequest(context.token, "setMessageReaction", {
            chat_id: context.chatId,
            message_id: messageId,
            reaction: [
              { type: "emoji", emoji: stringValue(action.payload.emoji) },
            ],
          });
          break;
        default:
          return {
            outcome: "unsupported",
            errorCode: "telegram_action_unsupported",
          };
      }
      return { outcome: "confirmed" };
    } catch (error) {
      const failed = providerFailure(error);
      return {
        outcome:
          failed.outcome === "transient_failure"
            ? "transient_failure"
            : "permanent_failure",
        errorCode: failed.errorCode,
        retryAfterMs: failed.retryAfterMs,
      };
    }
  }
}

async function resolveContext(intent: {
  companyId: string;
  channelAccountId: string;
  conversationId: string;
}): Promise<{
  token: string;
  chatId: string;
  messageThreadId?: number;
  externalThreadId: string;
}> {
  const tenantDb = await getTenantConnection(intent.companyId);
  const [token, conversation] = await Promise.all([
    readChannelCredential(
      tenantDb,
      intent.companyId,
      intent.channelAccountId,
      "telegram_bot_token",
    ),
    tenantDb
      .selectFrom("conversations")
      .select("external_thread_id")
      .where("id", "=", intent.conversationId)
      .where("channel_account_id", "=", intent.channelAccountId)
      .executeTakeFirst(),
  ]);
  if (!token) throw new Error("telegram_credential_unavailable");
  if (!conversation?.external_thread_id) {
    throw new Error("telegram_conversation_unavailable");
  }
  const match = /^(-?\d+)(?::thread:(\d+))?$/.exec(
    conversation.external_thread_id,
  );
  if (!match) throw new Error("telegram_conversation_invalid");
  return {
    token,
    chatId: match[1]!,
    messageThreadId: match[2] ? Number(match[2]) : undefined,
    externalThreadId: conversation.external_thread_id,
  };
}

function providerFailure(
  error: unknown,
): Extract<
  ProviderSendResult,
  { outcome: "transient_failure" | "permanent_failure" | "uncertain" }
> {
  const message = error instanceof Error ? error.message : "";
  if (
    message === "Telegram Bot API is unavailable" ||
    message === "Telegram Bot API returned an invalid response"
  ) {
    return {
      outcome: "transient_failure",
      errorCode: "telegram_temporarily_unavailable",
      retryAfterMs: 5_000,
    };
  }
  const knownCodes = new Set([
    "telegram_credential_unavailable",
    "telegram_conversation_unavailable",
    "telegram_conversation_invalid",
    "telegram_attachment_missing",
    "Telegram Bot API rejected the request",
  ]);
  return {
    outcome: "permanent_failure",
    errorCode: knownCodes.has(message)
      ? message.toLowerCase().replaceAll(" ", "_")
      : "telegram_send_failed",
  };
}

function optionalReply(value: unknown): { message_id: number } | undefined {
  const messageId = numberValue(value);
  return messageId ? { message_id: messageId } : undefined;
}

function firstAttachment(value: unknown): Record<string, unknown> | undefined {
  return Array.isArray(value) && value[0] && typeof value[0] === "object"
    ? (value[0] as Record<string, unknown>)
    : undefined;
}

async function attachmentUrl(
  companyId: string,
  attachment?: Record<string, unknown>,
): Promise<string> {
  const storageUri = attachment && stringValue(attachment.storageUri);
  if (!storageUri) throw new Error("telegram_attachment_missing");
  const key = resolveMediaKeyForCompany(storageUri, companyId);
  return getPresignedUrl(key, 10 * 60);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}
