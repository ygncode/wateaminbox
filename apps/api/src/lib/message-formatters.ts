/**
 * Message Formatters
 *
 * Shared utilities for formatting messages from database format to API response format.
 * These functions ensure consistent message formatting across different routes.
 */

import { getAuthorizedMediaUrl } from "./storage.js";

/**
 * Database message row type (from Kysely query)
 */
export interface MessageDbRow {
  id: string;
  message_id: string | null;
  contact_id: string;
  whatsapp_connection_id: string | null;
  from_me: boolean;
  sender_jid: string | null;
  sender_name: string | null;
  sender_avatar_url: string | null;
  sent_by_user_id: string | null;
  message_type: string;
  content: string | null;
  media_url: string | null;
  media_mime_type: string | null;
  media_size: number | null;
  media_direct_path: string | null;
  media_download_status: string | null;
  metadata: Record<string, unknown> | null;
  quoted_message_id: string | null;
  is_forwarded: boolean;
  is_starred: boolean;
  deleted_by_sender: boolean;
  deleted_at: Date | null;
  status: string | null;
  timestamp: Date;
  created_at: Date;
}

/**
 * Quoted message data for conversation format
 */
export interface QuotedMessageData {
  id: string;
  conversationId: string;
  senderId: string;
  senderType: "user" | "contact";
  senderJid: string | null;
  senderName: string | null;
  sentByUserId: string | null;
  sentByUserName: string | null;
  messageType: string;
  content: string;
  isDeleted: boolean;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Reaction data
 */
export interface ReactionData {
  emoji: string;
  reactorJid: string;
  reactorPhoneNumber?: string | null;
  reactorName?: string | null;
  reactorAvatarUrl?: string | null;
  isOwn?: boolean;
  createdAt: Date;
}

export interface MessageUserAvatarSources {
  avatarUrl: string;
  gravatarUrl: string;
}

/**
 * Message metadata object shared across formats
 */
export interface MessageMetadata {
  mediaUrl: string | null;
  mimeType: string | null;
  fileSize: number | null;
  mediaPending: boolean;
  mediaDownloadStatus: string | null;
  mediaAlbumId?: string;
  mediaAlbumIndex?: number;
  mediaAlbumCount?: number;
}

function optionalAlbumString(
  metadata: Record<string, unknown> | null,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalAlbumInteger(
  metadata: Record<string, unknown> | null,
  key: string,
): number | undefined {
  const value = metadata?.[key];
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

/**
 * Replace private persisted references with fresh, short-lived URLs. Call this
 * only after the route has enforced message/contact visibility.
 */
export async function authorizeMessageMedia(
  messages: MessageDbRow[],
  companyId: string,
): Promise<MessageDbRow[]> {
  const authorize = async (reference: string | null) => {
    try {
      return await getAuthorizedMediaUrl(reference, companyId);
    } catch {
      // Never echo malformed, external, or cross-tenant persisted references.
      return null;
    }
  };
  return Promise.all(
    messages.map(async (message) => ({
      ...message,
      media_url: await authorize(message.media_url),
      sender_avatar_url: await authorize(message.sender_avatar_url),
    })),
  );
}

/**
 * Build metadata object from database row
 */
export function buildMessageMetadata(msg: MessageDbRow): MessageMetadata {
  return {
    mediaUrl: msg.media_url,
    mimeType: msg.media_mime_type,
    fileSize: msg.media_size,
    mediaPending:
      msg.media_download_status === "pending" && msg.media_direct_path !== null,
    mediaDownloadStatus: msg.media_download_status,
    mediaAlbumId: optionalAlbumString(msg.metadata, "mediaAlbumId"),
    mediaAlbumIndex: optionalAlbumInteger(msg.metadata, "mediaAlbumIndex"),
    mediaAlbumCount: optionalAlbumInteger(msg.metadata, "mediaAlbumCount"),
  };
}

/**
 * Format a message for the conversations route (GET /conversations/:id/messages)
 *
 * Uses `replyToMessage`/`replyToMessageId` and `senderType`/`senderId` format.
 * Includes `reactions` array.
 */
export function formatMessageForConversation(
  msg: MessageDbRow,
  quotedMessagesMap: Map<string, QuotedMessageData>,
  reactionsMap: Map<string, ReactionData[]>,
  userNames: Map<string, string> = new Map(),
  userAvatarSources: Map<string, MessageUserAvatarSources> = new Map(),
) {
  return {
    id: msg.id,
    // Keep the legacy response key while also exposing the canonical shared
    // Message field used to match unresolved WhatsApp reply references.
    messageId: msg.message_id,
    whatsappMessageId: msg.message_id || undefined,
    conversationId: msg.contact_id,
    contactId: msg.contact_id,
    senderId: msg.sent_by_user_id || msg.sender_jid || "",
    senderType: msg.from_me ? "user" : "contact",
    senderJid: msg.sender_jid,
    senderName: msg.sender_name,
    senderAvatarUrl: msg.sender_avatar_url,
    sentByUserId: msg.sent_by_user_id,
    sentByUserName: msg.sent_by_user_id
      ? userNames.get(msg.sent_by_user_id) || null
      : null,
    sentByUserAvatarUrl: msg.sent_by_user_id
      ? userAvatarSources.get(msg.sent_by_user_id)?.avatarUrl || null
      : null,
    sentByUserGravatarUrl: msg.sent_by_user_id
      ? userAvatarSources.get(msg.sent_by_user_id)?.gravatarUrl || null
      : null,
    messageType: msg.message_type,
    content: msg.content || "",
    mediaUrl: msg.media_url,
    metadata: buildMessageMetadata(msg),
    replyToMessageId: msg.quoted_message_id || undefined,
    replyToMessage: msg.quoted_message_id
      ? quotedMessagesMap.get(msg.quoted_message_id) || null
      : undefined,
    isForwarded: msg.is_forwarded,
    isStarred: msg.is_starred,
    isDeleted: msg.deleted_by_sender || !!msg.deleted_at,
    deletedAt: msg.deleted_at,
    status: msg.status || (msg.from_me ? "sent" : "delivered"),
    timestamp: msg.timestamp,
    // `created_at` is when the row reached our database. History pages may be
    // imported months after the message was sent, so the UI-facing message date
    // must come from WhatsApp's original timestamp.
    createdAt: msg.timestamp,
    updatedAt: msg.created_at,
    reactions: reactionsMap.get(msg.id) || [],
  };
}

/**
 * Batch format messages for conversations route
 */
export function formatMessagesForConversation(
  messages: MessageDbRow[],
  quotedMessagesMap: Map<string, QuotedMessageData>,
  reactionsMap: Map<string, ReactionData[]>,
  userNames: Map<string, string> = new Map(),
  userAvatarSources: Map<string, MessageUserAvatarSources> = new Map(),
) {
  return messages.map((msg) =>
    formatMessageForConversation(
      msg,
      quotedMessagesMap,
      reactionsMap,
      userNames,
      userAvatarSources,
    ),
  );
}

/**
 * Quoted message data for fetch format (simpler structure)
 */
export interface QuotedMessageSimple {
  message_id: string | null;
  content: string | null;
  message_type: string;
  sender_jid: string | null;
}

/**
 * Format a message for the fetch route (GET /messages)
 *
 * Uses `quotedMessage` and `fromMe` format.
 * Includes `reactions` array.
 */
export function formatMessageForFetch(
  msg: MessageDbRow,
  quotedMessages: Map<string, QuotedMessageSimple>,
  reactionsMap: Map<string, ReactionData[]>,
  userNames: Map<string, string> = new Map(),
  userAvatarSources: Map<string, MessageUserAvatarSources> = new Map(),
) {
  return {
    id: msg.id,
    messageId: msg.message_id,
    contactId: msg.contact_id,
    fromMe: msg.from_me,
    senderJid: msg.sender_jid,
    senderName: msg.sender_name,
    senderAvatarUrl: msg.sender_avatar_url,
    sentByUserId: msg.sent_by_user_id,
    sentByUserName: msg.sent_by_user_id
      ? userNames.get(msg.sent_by_user_id) || null
      : null,
    sentByUserAvatarUrl: msg.sent_by_user_id
      ? userAvatarSources.get(msg.sent_by_user_id)?.avatarUrl || null
      : null,
    sentByUserGravatarUrl: msg.sent_by_user_id
      ? userAvatarSources.get(msg.sent_by_user_id)?.gravatarUrl || null
      : null,
    messageType: msg.message_type,
    content: msg.content,
    // Keep these at root for backwards compatibility
    mediaUrl: msg.media_url,
    mediaMimeType: msg.media_mime_type,
    mediaSize: msg.media_size,
    // Metadata object for frontend compatibility
    metadata: buildMessageMetadata(msg),
    quotedMessage: msg.quoted_message_id
      ? quotedMessages.get(msg.quoted_message_id) || null
      : null,
    isForwarded: msg.is_forwarded,
    isStarred: msg.is_starred,
    deletedBySender: msg.deleted_by_sender,
    deletedAt: msg.deleted_at,
    status: msg.status || "sent",
    timestamp: msg.timestamp,
    createdAt: msg.timestamp,
    reactions: reactionsMap.get(msg.id) || [],
  };
}

/**
 * Batch format messages for fetch route
 */
export function formatMessagesForFetch(
  messages: MessageDbRow[],
  quotedMessages: Map<string, QuotedMessageSimple>,
  reactionsMap: Map<string, ReactionData[]>,
  userNames: Map<string, string> = new Map(),
  userAvatarSources: Map<string, MessageUserAvatarSources> = new Map(),
) {
  return messages.map((msg) =>
    formatMessageForFetch(
      msg,
      quotedMessages,
      reactionsMap,
      userNames,
      userAvatarSources,
    ),
  );
}

/**
 * Build quoted message data for conversation format from a database row
 */
export function buildQuotedMessageData(
  q: MessageDbRow,
  userNames: Map<string, string> = new Map(),
): QuotedMessageData {
  return {
    id: q.id,
    conversationId: q.contact_id,
    senderId: q.sent_by_user_id || q.sender_jid || "",
    senderType: q.from_me ? "user" : "contact",
    senderJid: q.sender_jid,
    senderName: q.sender_name,
    sentByUserId: q.sent_by_user_id,
    sentByUserName: q.sent_by_user_id
      ? userNames.get(q.sent_by_user_id) || null
      : null,
    messageType: q.message_type,
    content: q.content || "",
    isDeleted: q.deleted_by_sender || !!q.deleted_at,
    status: q.status || (q.from_me ? "sent" : "delivered"),
    createdAt: q.timestamp,
    updatedAt: q.created_at,
  };
}
