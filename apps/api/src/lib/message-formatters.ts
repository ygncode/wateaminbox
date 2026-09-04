/**
 * Message Formatters
 *
 * Shared utilities for formatting messages from database format to API response format.
 * These functions ensure consistent message formatting across different routes.
 */

import {
  type ContactCardData,
  normalizeContactCards,
  type RawContactCard,
} from "./contact-card.js";
import {
  buildContentDisposition,
  fileNameFromMediaKey,
  resolveDownloadContentType,
  resolveDownloadFileName,
} from "./media-download-name.js";
import {
  getAuthorizedMediaUrl,
  type SignedResponseOverrides,
} from "./storage.js";

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
  fileName: string | null;
  fileSize: number | null;
  mediaPending: boolean;
  mediaDownloadStatus: string | null;
  mediaAlbumId?: string;
  mediaAlbumIndex?: number;
  mediaAlbumCount?: number;
  contactCards?: ContactCardData[];
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
 * Persisted shape of the `messages.metadata` JSONB column.
 *
 * It is deliberately small: anything the UI needs on every render belongs in a
 * real column. `fileName` lives here because it is document-only and arrives
 * on the receive event alone.
 */
export interface StoredMessageMetadata extends Record<string, unknown> {
  protocolSenderJid?: string;
  fileName?: string;
  contactCards?: ContactCardData[];
}

/**
 * Assemble the metadata blob for an inbound message, or null when there is
 * nothing worth storing - the column stays null for the text messages that are
 * the overwhelming majority of rows.
 */
export function buildInboundMessageMetadata(payload: {
  protocolSenderJid?: string;
  fileName?: string;
  messageType?: string;
  content?: string;
  contactCards?: RawContactCard[];
}): StoredMessageMetadata | null {
  const metadata: StoredMessageMetadata = {};
  if (payload.protocolSenderJid)
    metadata.protocolSenderJid = payload.protocolSenderJid;
  if (payload.fileName) metadata.fileName = payload.fileName;
  if (payload.messageType === "contact") {
    const contactCards = normalizeContactCards(
      payload.contactCards,
      payload.content,
    );
    if (contactCards.length > 0) metadata.contactCards = contactCards;
  }
  return Object.keys(metadata).length > 0 ? metadata : null;
}

/**
 * Media columns for an outbound message row.
 *
 * The filename and MIME type an outbound send is about to hand the worker are
 * the same ones the recipient's copy will carry, so the local row should record
 * them too. Without this the sender's own copy downloads under a synthetic
 * name while the recipient's is correct.
 */
export function buildOutboundMediaColumns(command: {
  file_name?: string;
  mime_type?: string;
  media_album_id?: string;
  media_album_index?: number;
  media_album_count?: number;
}): {
  media_mime_type: string | null;
  metadata: StoredMessageMetadata | null;
} {
  const metadata: StoredMessageMetadata = {};
  if (command.file_name) metadata.fileName = command.file_name;
  if (command.media_album_id) {
    metadata.mediaAlbumId = command.media_album_id;
    metadata.mediaAlbumIndex = command.media_album_index;
    metadata.mediaAlbumCount = command.media_album_count;
  }

  return {
    media_mime_type: command.mime_type ?? null,
    metadata: Object.keys(metadata).length > 0 ? metadata : null,
  };
}

/** Read the original filename back out of the stored blob, if there is one. */
export function readStoredFileName(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  const fileName = metadata?.fileName;
  return typeof fileName === "string" && fileName.length > 0 ? fileName : null;
}

/**
 * Replace private persisted references with fresh, short-lived URLs. Call this
 * only after the route has enforced message/contact visibility.
 */
export async function authorizeMessageMedia(
  messages: MessageDbRow[],
  companyId: string,
): Promise<MessageDbRow[]> {
  const authorize = async (
    reference: string | null,
    responseOverrides?: SignedResponseOverrides,
  ) => {
    try {
      return await getAuthorizedMediaUrl(
        reference,
        companyId,
        undefined,
        responseOverrides,
      );
    } catch {
      // Never echo malformed, external, or cross-tenant persisted references.
      return null;
    }
  };
  return Promise.all(
    messages.map(async (message) => ({
      ...message,
      media_url: await authorize(
        message.media_url,
        documentDownloadOverrides(message),
      ),
      sender_avatar_url: await authorize(message.sender_avatar_url),
    })),
  );
}

/**
 * Documents are downloaded, not rendered, so their signed URL restates the
 * original filename and a usable content type. Images, video, and audio are
 * left alone: they are played and previewed in place, and an `attachment`
 * disposition on a lightbox source is at best pointless.
 */
function documentDownloadOverrides(
  message: MessageDbRow,
): SignedResponseOverrides | undefined {
  if (message.message_type !== "document") return undefined;

  // Messages stored before the filename was persisted fall back to the name
  // embedded in the storage key.
  const storedName =
    readStoredFileName(message.metadata) ??
    fileNameFromMediaKey(message.media_url);
  const fileName = resolveDownloadFileName(storedName, message.media_mime_type);
  const contentType = resolveDownloadContentType(
    storedName,
    message.media_mime_type,
  );
  // PDFs are previewed in the lightbox, so they keep `inline` - an attachment
  // disposition would turn the preview into a download. They still get the
  // corrected name, which is what the browser's own save button uses.
  const disposition =
    contentType === "application/pdf" ? "inline" : "attachment";
  return {
    contentDisposition: buildContentDisposition(fileName, disposition),
    contentType,
  };
}

/**
 * Build metadata object from database row
 */
export function buildMessageMetadata(msg: MessageDbRow): MessageMetadata {
  const contactCards = normalizeStoredContactCards(msg.metadata?.contactCards);
  return {
    mediaUrl: msg.media_url,
    mimeType: msg.media_mime_type,
    // Same fallback as the download name, so the bubble and the saved file
    // agree on what the document is called.
    fileName:
      readStoredFileName(msg.metadata) ?? fileNameFromMediaKey(msg.media_url),
    fileSize: msg.media_size,
    mediaPending:
      msg.media_download_status === "pending" && msg.media_direct_path !== null,
    mediaDownloadStatus: msg.media_download_status,
    mediaAlbumId: optionalAlbumString(msg.metadata, "mediaAlbumId"),
    mediaAlbumIndex: optionalAlbumInteger(msg.metadata, "mediaAlbumIndex"),
    mediaAlbumCount: optionalAlbumInteger(msg.metadata, "mediaAlbumCount"),
    ...(contactCards.length > 0 ? { contactCards } : {}),
  };
}

function normalizeStoredContactCards(value: unknown): ContactCardData[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap((card) => {
    if (!card || typeof card !== "object") return [];
    const candidate = card as Record<string, unknown>;
    if (typeof candidate.displayName !== "string") return [];
    const phoneNumbers = Array.isArray(candidate.phoneNumbers)
      ? candidate.phoneNumbers.slice(0, 10).flatMap((phone) => {
          if (!phone || typeof phone !== "object") return [];
          const item = phone as Record<string, unknown>;
          if (typeof item.value !== "string") return [];
          return [
            {
              value: item.value,
              ...(typeof item.label === "string" ? { label: item.label } : {}),
            },
          ];
        })
      : [];
    return [{ displayName: candidate.displayName, phoneNumbers }];
  });
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
