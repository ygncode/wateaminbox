import {
  assertNormalizedChannelEvent,
  type ExternalConversationReference,
  type ExternalEndpointReference,
  type MessageMutationEventPayload,
  type MessageUpsertEventPayload,
  type NormalizedAttachment,
  type NormalizedChannelEvent,
  type ReactionEventPayload,
} from "@wateaminbox/shared";

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
  message_reaction?: TelegramMessageReactionUpdated;
}

interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel" | string;
  title?: string;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface TelegramFile {
  file_id: string;
  file_unique_id?: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TelegramMessage {
  message_id: number;
  message_thread_id?: number;
  date: number;
  edit_date?: number;
  chat: TelegramChat;
  from?: TelegramUser;
  sender_chat?: TelegramChat;
  text?: string;
  caption?: string;
  reply_to_message?: { message_id?: number };
  media_group_id?: string;
  photo?: Array<TelegramFile & { width?: number; height?: number }>;
  animation?: TelegramFile;
  audio?: TelegramFile;
  document?: TelegramFile;
  sticker?: TelegramFile & { is_animated?: boolean; is_video?: boolean };
  video?: TelegramFile;
  video_note?: TelegramFile;
  voice?: TelegramFile;
  location?: unknown;
  venue?: unknown;
  contact?: unknown;
  poll?: unknown;
  dice?: unknown;
  [key: string]: unknown;
}

type TelegramReactionType =
  | { type: "emoji"; emoji: string }
  | { type: "custom_emoji"; custom_emoji_id: string }
  | { type: "paid" };

interface TelegramMessageReactionUpdated {
  chat: TelegramChat;
  message_id: number;
  message_thread_id?: number;
  user?: TelegramUser;
  actor_chat?: TelegramChat;
  date: number;
  old_reaction: TelegramReactionType[];
  new_reaction: TelegramReactionType[];
}

export interface TelegramNormalizationContext {
  companyId: string;
  channelAccountId: string;
  receivedAt: string;
}

/** Normalize the Bot API update without retaining the original webhook payload. */
export function normalizeTelegramUpdate(
  value: unknown,
  context: TelegramNormalizationContext,
): NormalizedChannelEvent[] {
  const update = requireUpdate(value);

  if (update.message) {
    return normalizeMessage(update, update.message, "message.upsert", context);
  }
  if (update.channel_post) {
    return normalizeMessage(
      update,
      update.channel_post,
      "message.upsert",
      context,
    );
  }
  if (update.edited_message) {
    return normalizeMessage(
      update,
      update.edited_message,
      "message.edit",
      context,
    );
  }
  if (update.edited_channel_post) {
    return normalizeMessage(
      update,
      update.edited_channel_post,
      "message.edit",
      context,
    );
  }
  if (update.message_reaction) {
    return normalizeReaction(update, update.message_reaction, context);
  }

  return [];
}

function normalizeMessage(
  update: TelegramUpdate,
  message: TelegramMessage,
  kind: "message.upsert" | "message.edit",
  context: TelegramNormalizationContext,
): NormalizedChannelEvent[] {
  requireMessage(message);
  const conversation = conversationReference(
    message.chat,
    message.message_thread_id,
  );
  const identityScope = messageIdentityScope(conversation.externalThreadId!);
  const occurredAt = unixSecondsToIso(
    kind === "message.edit"
      ? (message.edit_date ?? message.date)
      : message.date,
    "message date",
  );
  const base = {
    contractVersion: 1 as const,
    eventId: `telegram:${update.update_id}:${kind}`,
    companyId: context.companyId,
    channelAccountId: context.channelAccountId,
    channel: "telegram" as const,
    provider: "telegram_bot" as const,
    providerOccurredAt: occurredAt,
    receivedAt: context.receivedAt,
  };

  let event: NormalizedChannelEvent;
  if (kind === "message.edit") {
    const payload: MessageMutationEventPayload = {
      conversation,
      externalMessageId: String(message.message_id),
      externalIdentityScope: identityScope,
      textContent: message.text ?? message.caption,
      providerMetadata: message.media_group_id
        ? { mediaGroupId: message.media_group_id }
        : undefined,
    };
    event = { ...base, kind, payload };
  } else {
    const payload: MessageUpsertEventPayload = {
      conversation,
      externalMessageId: String(message.message_id),
      externalIdentityScope: identityScope,
      direction: "inbound",
      sender: message.from
        ? userEndpoint(message.from)
        : message.sender_chat
          ? chatEndpoint(message.sender_chat)
          : undefined,
      normalizedType: normalizedMessageType(message),
      textContent: message.text ?? message.caption,
      replyToExternalMessageId:
        typeof message.reply_to_message?.message_id === "number"
          ? String(message.reply_to_message.message_id)
          : undefined,
      attachments: normalizeAttachments(message),
      providerMetadata: message.media_group_id
        ? { mediaGroupId: message.media_group_id }
        : undefined,
    };
    event = { ...base, kind, payload };
  }

  assertNormalizedChannelEvent(event);
  const sender = message.from
    ? userEndpoint(message.from)
    : message.sender_chat
      ? chatEndpoint(message.sender_chat)
      : undefined;
  return [
    ...referenceEvents(
      update.update_id,
      conversation,
      sender,
      occurredAt,
      context,
    ),
    event,
  ];
}

function normalizeReaction(
  update: TelegramUpdate,
  reaction: TelegramMessageReactionUpdated,
  context: TelegramNormalizationContext,
): NormalizedChannelEvent[] {
  requireReaction(reaction);
  const conversation = conversationReference(
    reaction.chat,
    reaction.message_thread_id,
  );
  const reactor = reaction.user
    ? userEndpoint(reaction.user)
    : reaction.actor_chat
      ? chatEndpoint(reaction.actor_chat)
      : undefined;
  if (!reactor) throw new Error("Telegram reaction has no actor");

  const occurredAt = unixSecondsToIso(reaction.date, "reaction date");
  const oldCounts = reactionCounts(reaction.old_reaction);
  const newCounts = reactionCounts(reaction.new_reaction);
  const events = referenceEvents(
    update.update_id,
    conversation,
    reactor,
    occurredAt,
    context,
  );
  let ordinal = 0;

  for (const [key, descriptor] of allReactionDescriptors(
    reaction.old_reaction,
    reaction.new_reaction,
  )) {
    const difference = (newCounts.get(key) ?? 0) - (oldCounts.get(key) ?? 0);
    const kind = difference > 0 ? "reaction.upsert" : "reaction.delete";
    for (let index = 0; index < Math.abs(difference); index += 1) {
      const payload: ReactionEventPayload = {
        conversation,
        messageExternalId: String(reaction.message_id),
        messageIdentityScope: messageIdentityScope(
          conversation.externalThreadId!,
        ),
        externalReactionId: `${reactor.identityScope}:${reactor.externalId}:${reaction.message_id}:${key}`,
        externalEventScope: "telegram-reaction",
        reactor,
        emoji: reactionDisplayValue(descriptor),
      };
      const event: NormalizedChannelEvent = {
        contractVersion: 1,
        eventId: `telegram:${update.update_id}:${kind}:${ordinal}`,
        companyId: context.companyId,
        channelAccountId: context.channelAccountId,
        channel: "telegram",
        provider: "telegram_bot",
        kind,
        providerOccurredAt: occurredAt,
        receivedAt: context.receivedAt,
        payload,
      };
      assertNormalizedChannelEvent(event);
      events.push(event);
      ordinal += 1;
    }
  }
  return events;
}

function referenceEvents(
  updateId: number,
  conversation: ExternalConversationReference,
  endpoint: ExternalEndpointReference | undefined,
  occurredAt: string,
  context: TelegramNormalizationContext,
): NormalizedChannelEvent[] {
  const events: NormalizedChannelEvent[] = [];
  if (endpoint) {
    const endpointEvent: NormalizedChannelEvent = {
      contractVersion: 1,
      eventId: `telegram:${updateId}:endpoint.upsert`,
      companyId: context.companyId,
      channelAccountId: context.channelAccountId,
      channel: "telegram",
      provider: "telegram_bot",
      kind: "endpoint.upsert",
      providerOccurredAt: occurredAt,
      receivedAt: context.receivedAt,
      payload: {
        endpoint,
        verificationState: "provider_verified",
      },
    };
    assertNormalizedChannelEvent(endpointEvent);
    events.push(endpointEvent);
  }

  const conversationEvent: NormalizedChannelEvent = {
    contractVersion: 1,
    eventId: `telegram:${updateId}:conversation.upsert`,
    companyId: context.companyId,
    channelAccountId: context.channelAccountId,
    channel: "telegram",
    provider: "telegram_bot",
    kind: "conversation.upsert",
    providerOccurredAt: occurredAt,
    receivedAt: context.receivedAt,
    payload: { conversation },
  };
  assertNormalizedChannelEvent(conversationEvent);
  events.push(conversationEvent);
  return events;
}

function conversationReference(
  chat: TelegramChat,
  messageThreadId?: number,
): ExternalConversationReference {
  requireChat(chat);
  const chatId = String(chat.id);
  const externalThreadId =
    typeof messageThreadId === "number"
      ? `${chatId}:thread:${messageThreadId}`
      : chatId;
  return {
    externalThreadId,
    clientThreadKey: `telegram:${externalThreadId}`,
    kind:
      typeof messageThreadId === "number"
        ? "thread"
        : chat.type === "private"
          ? "direct"
          : "group",
    subject: chat.type === "private" ? undefined : chat.title,
  };
}

function userEndpoint(user: TelegramUser): ExternalEndpointReference {
  if (!Number.isSafeInteger(user.id))
    throw new Error("Invalid Telegram user ID");
  return {
    externalId: String(user.id),
    identityScope: "telegram-user",
    endpointKind: user.is_bot ? "bot" : "person",
    displayName: displayName(user),
    // The username is the only human-addressable handle the Bot API gives us:
    // a phone number is never in an update and cannot be requested, so without
    // this a Telegram contact has no identifier a teammate can act on.
    // Retained deliberately; quoted bodies, file ids and entities still are not.
    addressDisplay: user.username ? `@${user.username}` : undefined,
    normalizedAddress: user.username?.toLowerCase(),
  };
}

function chatEndpoint(chat: TelegramChat): ExternalEndpointReference {
  requireChat(chat);
  return {
    externalId: String(chat.id),
    identityScope: "telegram-chat",
    endpointKind: chat.type === "channel" ? "channel" : "group",
    displayName: chat.title ?? displayName(chat),
    addressDisplay: chat.username ? `@${chat.username}` : undefined,
    normalizedAddress: chat.username?.toLowerCase(),
  };
}

function displayName(value: {
  first_name?: string;
  last_name?: string;
  username?: string;
}): string | undefined {
  const name = [value.first_name, value.last_name].filter(Boolean).join(" ");
  return name || value.username;
}

function messageIdentityScope(externalThreadId: string): string {
  return `telegram-thread:${externalThreadId}`;
}

function normalizedMessageType(message: TelegramMessage): string {
  if (typeof message.text === "string") return "text";
  if (message.photo) return "image";
  if (message.animation) return "animation";
  if (message.video) return "video";
  if (message.video_note) return "video_note";
  if (message.audio) return "audio";
  if (message.voice) return "voice";
  if (message.document) return "document";
  if (message.sticker) return "sticker";
  if (message.venue) return "venue";
  if (message.location) return "location";
  if (message.contact) return "contact";
  if (message.poll) return "poll";
  if (message.dice) return "dice";
  return "system";
}

function normalizeAttachments(
  message: TelegramMessage,
): NormalizedAttachment[] | undefined {
  const candidates: Array<[string, TelegramFile | undefined]> = [
    ["image", message.photo?.at(-1)],
    ["animation", message.animation],
    ["video", message.video],
    ["video_note", message.video_note],
    ["audio", message.audio],
    ["voice", message.voice],
    ["document", message.document],
    ["sticker", message.sticker],
  ];
  const selected = candidates.find(([, file]) => file !== undefined);
  if (!selected) return undefined;
  const [kind, file] = selected;
  if (
    !isRecord(file) ||
    typeof file.file_id !== "string" ||
    file.file_id.length === 0
  ) {
    throw new Error("Telegram attachment has no file ID");
  }
  requireOptionalStrings(file, ["file_name", "mime_type"]);
  if (
    file.file_size !== undefined &&
    (!Number.isSafeInteger(file.file_size) || file.file_size < 0)
  ) {
    throw new Error("Invalid Telegram attachment size");
  }
  return [
    {
      ordinal: 0,
      kind,
      providerAttachmentId: file.file_id,
      fileName: file.file_name,
      // A Telegram Sticker carries no `mime_type`, unlike every other file
      // object, so without this it stored as application/octet-stream and the
      // client had nothing it could render.
      contentType: file.mime_type ?? stickerContentType(kind, message.sticker),
      byteSize:
        typeof file.file_size === "number" &&
        Number.isSafeInteger(file.file_size)
          ? file.file_size
          : undefined,
      status: "pending",
    },
  ];
}

/**
 * Telegram ships three sticker encodings behind one field. Only the static
 * and video forms are renderable in a browser; the animated form is gzipped
 * Lottie JSON, so it is left untyped rather than mislabelled as an image.
 */
function stickerContentType(
  kind: string,
  sticker: { is_animated?: boolean; is_video?: boolean } | undefined,
): string | undefined {
  if (kind !== "sticker" || !sticker) return undefined;
  if (sticker.is_video) return "video/webm";
  if (sticker.is_animated) return undefined;
  return "image/webp";
}

function reactionKey(reaction: TelegramReactionType): string {
  switch (reaction.type) {
    case "emoji":
      if (typeof reaction.emoji !== "string" || reaction.emoji.length === 0) {
        throw new Error("Invalid Telegram emoji reaction");
      }
      return `emoji:${reaction.emoji}`;
    case "custom_emoji":
      if (
        typeof reaction.custom_emoji_id !== "string" ||
        reaction.custom_emoji_id.length === 0
      ) {
        throw new Error("Invalid Telegram custom emoji reaction");
      }
      return `custom:${reaction.custom_emoji_id}`;
    case "paid":
      return "paid";
    default:
      throw new Error("Unsupported Telegram reaction type");
  }
}

function reactionDisplayValue(reaction: TelegramReactionType): string {
  if (reaction.type === "emoji") return reaction.emoji;
  if (reaction.type === "custom_emoji") {
    return `custom_emoji:${reaction.custom_emoji_id}`;
  }
  return "⭐";
}

function reactionCounts(
  reactions: TelegramReactionType[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const reaction of reactions) {
    const key = reactionKey(reaction);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function allReactionDescriptors(
  oldReactions: TelegramReactionType[],
  newReactions: TelegramReactionType[],
): Map<string, TelegramReactionType> {
  const descriptors = new Map<string, TelegramReactionType>();
  for (const reaction of [...oldReactions, ...newReactions]) {
    descriptors.set(reactionKey(reaction), reaction);
  }
  return descriptors;
}

function requireUpdate(value: unknown): TelegramUpdate {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.update_id) ||
    (value.update_id as number) < 0
  ) {
    throw new Error("Invalid Telegram update");
  }
  return value as unknown as TelegramUpdate;
}

function requireMessage(message: TelegramMessage): void {
  if (
    !isRecord(message) ||
    !isPositiveSafeInteger(message.message_id) ||
    !Number.isFinite(message.date) ||
    !isRecord(message.chat) ||
    (message.message_thread_id !== undefined &&
      !isPositiveSafeInteger(message.message_thread_id)) ||
    (message.edit_date !== undefined && !Number.isFinite(message.edit_date))
  ) {
    throw new Error("Invalid Telegram message");
  }
  requireOptionalStrings(message, ["text", "caption", "media_group_id"]);
  if (message.from !== undefined) requireUser(message.from);
  if (message.sender_chat !== undefined) requireChat(message.sender_chat);
  if (message.reply_to_message !== undefined) {
    if (
      !isRecord(message.reply_to_message) ||
      (message.reply_to_message.message_id !== undefined &&
        !isPositiveSafeInteger(message.reply_to_message.message_id))
    ) {
      throw new Error("Invalid Telegram reply reference");
    }
  }
  if (
    message.photo !== undefined &&
    (!Array.isArray(message.photo) || message.photo.length === 0)
  ) {
    throw new Error("Invalid Telegram photo attachment");
  }
}

function requireReaction(reaction: TelegramMessageReactionUpdated): void {
  if (
    !isRecord(reaction) ||
    !isPositiveSafeInteger(reaction.message_id) ||
    !Number.isFinite(reaction.date) ||
    !isRecord(reaction.chat) ||
    (reaction.message_thread_id !== undefined &&
      !isPositiveSafeInteger(reaction.message_thread_id)) ||
    !Array.isArray(reaction.old_reaction) ||
    !Array.isArray(reaction.new_reaction)
  ) {
    throw new Error("Invalid Telegram reaction update");
  }
  if (reaction.user !== undefined) requireUser(reaction.user);
  if (reaction.actor_chat !== undefined) requireChat(reaction.actor_chat);
}

function requireChat(chat: TelegramChat): void {
  if (
    !isRecord(chat) ||
    !Number.isSafeInteger(chat.id) ||
    chat.id === 0 ||
    typeof chat.type !== "string" ||
    chat.type.length === 0
  ) {
    throw new Error("Invalid Telegram chat");
  }
  requireOptionalStrings(chat, [
    "title",
    "first_name",
    "last_name",
    "username",
  ]);
}

function requireUser(user: TelegramUser): void {
  if (
    !isRecord(user) ||
    !isPositiveSafeInteger(user.id) ||
    (user.is_bot !== undefined && typeof user.is_bot !== "boolean")
  ) {
    throw new Error("Invalid Telegram user");
  }
  requireOptionalStrings(user, ["first_name", "last_name", "username"]);
}

function requireOptionalStrings(value: object, keys: readonly string[]): void {
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (record[key] !== undefined && typeof record[key] !== "string") {
      throw new Error(`Invalid Telegram ${key}`);
    }
  }
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function unixSecondsToIso(value: number, field: string): string {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid Telegram ${field}`);
  }
  const date = new Date(value * 1_000);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`Invalid Telegram ${field}`);
  }
  return date.toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
