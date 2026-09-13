import type {
  ChannelActionIntent,
  OutboundMessageIntent,
  ProviderActionResult,
  ProviderSendResult,
} from "@wateaminbox/shared";
import type { TelegramBotOutboundTransport } from "./adapter.js";
import { telegramBotRequest } from "./api.js";

interface TelegramMessageResult {
  message_id: number;
}

/**
 * Failures raised before Telegram is contacted at all.
 *
 * These are the only outcomes that may be classified permanent without
 * hearing from the provider, so the set is closed and the host's port
 * implementations raise from it rather than inventing their own codes.
 */
export const TELEGRAM_LOCAL_FAILURE_CODES = [
  "telegram_credential_unavailable",
  // A key the process was started without is a configuration fault: the stored
  // credential is intact and Telegram is fine, so the send certainly never
  // happened. Reporting it as an unknown outcome parks the intent for ever -
  // uncertain outcomes are deliberately never retried, because Telegram has no
  // idempotency key - and hides an operator-fixable problem behind the label
  // reserved for "we could not tell what happened".
  "telegram_credential_key_unavailable",
  "telegram_conversation_unavailable",
  "telegram_conversation_invalid",
  "telegram_attachment_missing",
] as const;

export type TelegramLocalFailureCode =
  (typeof TELEGRAM_LOCAL_FAILURE_CODES)[number];

export class TelegramLocalFailureError extends Error {
  constructor(readonly code: TelegramLocalFailureCode) {
    super(code);
    this.name = "TelegramLocalFailureError";
  }
}

/** Where one conversation's outbound traffic goes, resolved by the host. */
export interface TelegramOutboundContext {
  token: string;
  chatId: string;
  messageThreadId?: number;
  externalThreadId: string;
}

export interface TelegramOutboundTarget {
  companyId: string;
  channelAccountId: string;
  conversationId: string;
}

/**
 * The host-owned half of outbound sending.
 *
 * Credential decryption, tenant database access, and media storage stay with
 * the application; this package keeps only Bot API knowledge.
 */
export interface TelegramTransportPorts {
  resolveOutboundContext(
    target: TelegramOutboundTarget,
  ): Promise<TelegramOutboundContext>;
  resolveAttachmentUrl(
    companyId: string,
    attachment: Record<string, unknown> | undefined,
  ): Promise<string>;
}

/**
 * Split an `external_thread_id` into its Bot API target.
 *
 * The encoding is Telegram's own, so it is parsed here rather than by the
 * host that happens to store the column.
 */
export function parseTelegramThreadTarget(externalThreadId: string): {
  chatId: string;
  messageThreadId?: number;
} {
  const match = /^(-?\d+)(?::thread:(\d+))?$/.exec(externalThreadId);
  if (!match) {
    throw new TelegramLocalFailureError("telegram_conversation_invalid");
  }
  return {
    chatId: match[1]!,
    messageThreadId: match[2] ? Number(match[2]) : undefined,
  };
}

export class TelegramBotApiTransport implements TelegramBotOutboundTransport {
  readonly #ports: TelegramTransportPorts;

  constructor(ports: TelegramTransportPorts) {
    this.#ports = ports;
  }

  async send(intent: OutboundMessageIntent): Promise<ProviderSendResult> {
    try {
      const context = await this.#ports.resolveOutboundContext(intent);
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
          request.photo = await this.#attachmentUrl(
            intent.companyId,
            attachment,
          );
          request.caption = text || undefined;
          break;
        case "video":
          method = "sendVideo";
          request.video = await this.#attachmentUrl(
            intent.companyId,
            attachment,
          );
          request.caption = text || undefined;
          break;
        case "audio":
          method = "sendAudio";
          request.audio = await this.#attachmentUrl(
            intent.companyId,
            attachment,
          );
          request.caption = text || undefined;
          break;
        case "voice":
          method = "sendVoice";
          request.voice = await this.#attachmentUrl(
            intent.companyId,
            attachment,
          );
          request.caption = text || undefined;
          break;
        case "document":
          method = "sendDocument";
          request.document = await this.#attachmentUrl(
            intent.companyId,
            attachment,
          );
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
      return classifyTelegramSendFailure(error);
    }
  }

  async perform(action: ChannelActionIntent): Promise<ProviderActionResult> {
    try {
      const context = await this.#ports.resolveOutboundContext(action);
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
      const failed = classifyTelegramSendFailure(error);
      return {
        outcome:
          failed.outcome === "transient_failure"
            ? "transient_failure"
            : failed.outcome === "uncertain"
              ? "uncertain"
              : "permanent_failure",
        errorCode: failed.errorCode,
        retryAfterMs: failed.retryAfterMs,
      };
    }
  }

  async #attachmentUrl(
    companyId: string,
    attachment?: Record<string, unknown>,
  ): Promise<string> {
    if (!attachment) {
      throw new TelegramLocalFailureError("telegram_attachment_missing");
    }
    return this.#ports.resolveAttachmentUrl(companyId, attachment);
  }
}

export function classifyTelegramSendFailure(
  error: unknown,
): Extract<
  ProviderSendResult,
  { outcome: "transient_failure" | "permanent_failure" | "uncertain" }
> {
  const message = error instanceof Error ? error.message : "";
  if ((TELEGRAM_LOCAL_FAILURE_CODES as readonly string[]).includes(message)) {
    return { outcome: "permanent_failure", errorCode: message };
  }
  if (message === "Telegram Bot API rejected the request") {
    return {
      outcome: "permanent_failure",
      errorCode: "telegram_request_rejected",
    };
  }
  // Telegram has no send idempotency key. Any other error may have happened
  // after provider acceptance, so automatic retry could duplicate a message.
  return {
    outcome: "uncertain",
    errorCode: "telegram_send_outcome_unknown",
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

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}
