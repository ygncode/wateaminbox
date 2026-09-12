import { createHash, timingSafeEqual } from "node:crypto";
import type {
  CapabilityContext,
  ChannelActionIntent,
  ChannelAdapter,
  OutboundMessageIntent,
  ProviderActionResult,
  ProviderIngress,
  ProviderSendResult,
  ResolvedCapabilities,
} from "@wateaminbox/shared";
import { ChannelCredentialKeyError } from "../../../services/channel-credential.service.js";
import { normalizeTelegramUpdate } from "./normalize.js";

const SECRET_HEADER = "x-telegram-bot-api-secret-token";
const MAX_WEBHOOK_BYTES = 1_048_576;

export interface TelegramWebhookSecretContext {
  companyId: string;
  channelAccountId: string;
}

export type TelegramWebhookSecretResolver = (
  context: TelegramWebhookSecretContext,
) => Promise<string | Uint8Array | null | undefined>;

export interface TelegramBotOutboundTransport {
  send(intent: OutboundMessageIntent): Promise<ProviderSendResult>;
  perform(action: ChannelActionIntent): Promise<ProviderActionResult>;
}

export interface TelegramBotAdapterDependencies {
  resolveWebhookSecret: TelegramWebhookSecretResolver;
  outboundTransport?: TelegramBotOutboundTransport;
}

export class TelegramIngressVerificationError extends Error {
  constructor() {
    super("Telegram webhook verification failed");
    this.name = "TelegramIngressVerificationError";
  }
}

export class TelegramBotAdapter implements ChannelAdapter {
  readonly channel = "telegram" as const;
  readonly provider = "telegram_bot" as const;

  readonly #resolveWebhookSecret: TelegramWebhookSecretResolver;
  readonly #outboundTransport?: TelegramBotOutboundTransport;

  constructor(dependencies: TelegramBotAdapterDependencies) {
    this.#resolveWebhookSecret = dependencies.resolveWebhookSecret;
    this.#outboundTransport = dependencies.outboundTransport;
  }

  async verifyAndNormalizeIngress(input: ProviderIngress) {
    let expected: Awaited<ReturnType<TelegramWebhookSecretResolver>>;
    try {
      expected = await this.#resolveWebhookSecret(input.trustedContext);
    } catch (error) {
      // A key this process was started without cannot be reported as a failed
      // signature check: the sender is probably legitimate and the fix is an
      // operator's, not a retry's.
      if (error instanceof ChannelCredentialKeyError) throw error;
      throw new TelegramIngressVerificationError();
    }
    const presented = headerValue(input.headers, SECRET_HEADER);
    if (
      !validSecret(expected) ||
      !presented ||
      !secureEqual(expected, presented)
    ) {
      throw new TelegramIngressVerificationError();
    }
    if (
      input.rawBody.byteLength === 0 ||
      input.rawBody.byteLength > MAX_WEBHOOK_BYTES
    ) {
      throw new Error("Invalid Telegram webhook body size");
    }

    let update: unknown;
    try {
      const body = new TextDecoder("utf-8", { fatal: true }).decode(
        input.rawBody,
      );
      update = JSON.parse(body) as unknown;
    } catch {
      throw new Error("Invalid Telegram webhook JSON");
    }

    return normalizeTelegramUpdate(update, {
      ...input.trustedContext,
      receivedAt: input.receivedAt,
    });
  }

  async resolveCapabilities(
    _context: CapabilityContext,
  ): Promise<ResolvedCapabilities> {
    return telegramBotCapabilities();
  }

  async send(intent: OutboundMessageIntent): Promise<ProviderSendResult> {
    if (!this.#outboundTransport) {
      return { outcome: "permanent_failure", errorCode: "adapter_not_wired" };
    }
    return this.#outboundTransport.send(intent);
  }

  async perform(action: ChannelActionIntent): Promise<ProviderActionResult> {
    if (!this.#outboundTransport) {
      return { outcome: "permanent_failure", errorCode: "adapter_not_wired" };
    }
    return this.#outboundTransport.perform(action);
  }
}

/** Conservative Bot API capabilities. Context never enables an unverified feature. */
/**
 * Reactions the Bot API accepts, from Telegram's documented set.
 *
 * `setMessageReaction` rejects anything outside this list with
 * REACTION_INVALID, so an emoji picker offering the full Unicode range queues
 * work that can only fail. Note 😁 (U+1F601) is included and 😂 (U+1F602) is
 * not - they are easy to confuse and Telegram accepts only the former.
 */
export const TELEGRAM_REACTION_EMOJIS = [
  "👍",
  "👎",
  "❤",
  "🔥",
  "🥰",
  "👏",
  "😁",
  "🤔",
  "🤯",
  "😱",
  "🤬",
  "😢",
  "🎉",
  "🤩",
  "🤮",
  "💩",
  "🙏",
  "👌",
  "🕊",
  "🤡",
  "🥱",
  "🥴",
  "😍",
  "🐳",
  "❤‍🔥",
  "🌚",
  "🌭",
  "💯",
  "🤣",
  "⚡",
  "🍌",
  "🏆",
  "💔",
  "🤨",
  "😐",
  "🍓",
  "🍾",
  "💋",
  "🖕",
  "😈",
  "😴",
  "😭",
  "🤓",
  "👻",
  "👨‍💻",
  "👀",
  "🎃",
  "🙈",
  "😇",
  "😨",
  "🤝",
  "✍",
  "🤗",
  "🫡",
  "🎅",
  "🎄",
  "☃",
  "💅",
  "🤪",
  "🗿",
  "🆒",
  "💘",
  "🙉",
  "🦄",
  "😘",
  "💊",
  "🙊",
  "😎",
  "👾",
  "🤷‍♂",
  "🤷",
  "🤷‍♀",
  "😡",
] as const;

export function telegramBotCapabilities(): ResolvedCapabilities {
  return {
    typing: true,
    readReceipts: false,
    reactions: true,
    reactionEmojis: TELEGRAM_REACTION_EMOJIS,
    messageEditing: true,
    messageDeletion: true,
    templates: false,
    groups: true,
    multipleRecipients: false,
    outboundInitiation: false,
    scheduledMessages: true,
    messageTypes: [
      { type: "text", enabled: true, maxTextLength: 4096 },
      {
        type: "image",
        enabled: true,
        caption: { enabled: true, maxLength: 1024 },
        attachment: { maxCount: 1 },
      },
      {
        type: "video",
        enabled: true,
        caption: { enabled: true, maxLength: 1024 },
        attachment: { maxCount: 1 },
      },
      { type: "audio", enabled: true, attachment: { maxCount: 1 } },
      { type: "voice", enabled: true, attachment: { maxCount: 1 } },
      {
        type: "document",
        enabled: true,
        caption: { enabled: true, maxLength: 1024 },
        attachment: { maxCount: 1 },
      },
      { type: "sticker", enabled: true, attachment: { maxCount: 1 } },
      { type: "location", enabled: true },
      { type: "contact", enabled: true },
    ],
    actions: {
      reply: true,
      quote: true,
      forward: true,
      retry: true,
      starLocally: true,
      deleteLocally: true,
      deleteForEveryone: true,
      groupMentions: true,
      remoteHistory: false,
    },
    attachment: { enabled: true, maxCount: 1 },
    constraints: {
      webhookAuthentication: "secret_token",
      outboundRequiresKnownChat: true,
      providerSideScheduling: false,
    },
    unavailableReasons: {
      readReceipts: {
        code: "telegram_read_receipts_unsupported",
        message: "Telegram bots do not receive message read receipts",
      },
      templates: {
        code: "telegram_templates_unsupported",
        message: "Telegram Bot API does not use message templates",
      },
      multipleRecipients: {
        code: "one_chat_per_send",
        message: "Each Bot API send targets one chat",
      },
      outboundInitiation: {
        code: "telegram_user_must_start_bot",
        message: "A bot cannot initiate a conversation with a user",
      },
    },
    version: "telegram-bot:v1",
  };
}

function headerValue(
  headers: Readonly<Record<string, string>>,
  soughtName: string,
): string | undefined {
  const matches = Object.entries(headers).filter(
    ([name]) => name.toLowerCase() === soughtName,
  );
  return matches.length === 1 ? matches[0]?.[1] : undefined;
}

function validSecret(
  value: string | Uint8Array | null | undefined,
): value is string | Uint8Array {
  return (
    value !== null &&
    value !== undefined &&
    value.length > 0 &&
    value.length <= 256
  );
}

function secureEqual(
  expected: string | Uint8Array,
  presented: string,
): boolean {
  // Comparing fixed-length digests avoids an early return that reveals secret length.
  const expectedDigest = createHash("sha256").update(expected).digest();
  const presentedDigest = createHash("sha256")
    .update(presented, "utf8")
    .digest();
  return timingSafeEqual(expectedDigest, presentedDigest);
}
