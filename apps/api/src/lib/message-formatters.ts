/**
 * Message Formatters
 *
 * Shared utilities for formatting messages from database format to API response format.
 * These functions ensure consistent message formatting across different routes.
 */

/**
 * Database message row type (from Kysely query)
 */
export interface MessageDbRow {
  id: string
  message_id: string | null
  contact_id: string
  from_me: boolean
  sender_jid: string | null
  sent_by_user_id: string | null
  message_type: string
  content: string | null
  media_url: string | null
  media_mime_type: string | null
  media_size: number | null
  media_direct_path: string | null
  media_download_status: string | null
  quoted_message_id: string | null
  is_forwarded: boolean
  is_starred: boolean
  deleted_by_sender: boolean
  deleted_at: Date | null
  status: string | null
  timestamp: Date
  created_at: Date
}

/**
 * Quoted message data for conversation format
 */
export interface QuotedMessageData {
  id: string
  conversationId: string
  senderId: string
  senderType: 'user' | 'contact'
  messageType: string
  content: string
  isDeleted: boolean
  status: string
  createdAt: Date
  updatedAt: Date
}

/**
 * Reaction data
 */
export interface ReactionData {
  emoji: string
  reactorJid: string
  createdAt: Date
}

/**
 * Message metadata object shared across formats
 */
export interface MessageMetadata {
  mediaUrl: string | null
  mimeType: string | null
  fileSize: number | null
  mediaPending: boolean
  mediaDownloadStatus: string | null
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
      msg.media_download_status === 'pending' && msg.media_direct_path !== null,
    mediaDownloadStatus: msg.media_download_status,
  }
}

/**
 * Format a message for the conversations route (GET /conversations/:id/messages)
 *
 * Uses `replyToMessage`/`replyToMessageId` and `senderType`/`senderId` format.
 */
export function formatMessageForConversation(
  msg: MessageDbRow,
  quotedMessagesMap: Map<string, QuotedMessageData>
) {
  return {
    id: msg.id,
    messageId: msg.message_id,
    conversationId: msg.contact_id,
    contactId: msg.contact_id,
    senderId: msg.sent_by_user_id || msg.sender_jid || '',
    senderType: msg.from_me ? 'user' : 'contact',
    senderJid: msg.sender_jid,
    messageType: msg.message_type,
    content: msg.content || '',
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
    sentByUserId: msg.sent_by_user_id,
    status: msg.status || (msg.from_me ? 'sent' : 'delivered'),
    timestamp: msg.timestamp,
    createdAt: msg.created_at,
    updatedAt: msg.created_at,
  }
}

/**
 * Batch format messages for conversations route
 */
export function formatMessagesForConversation(
  messages: MessageDbRow[],
  quotedMessagesMap: Map<string, QuotedMessageData>
) {
  return messages.map((msg) => formatMessageForConversation(msg, quotedMessagesMap))
}

/**
 * Quoted message data for fetch format (simpler structure)
 */
export interface QuotedMessageSimple {
  message_id: string | null
  content: string | null
  message_type: string
  sender_jid: string | null
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
  reactionsMap: Map<string, ReactionData[]>
) {
  return {
    id: msg.id,
    messageId: msg.message_id,
    contactId: msg.contact_id,
    fromMe: msg.from_me,
    senderJid: msg.sender_jid,
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
    sentByUserId: msg.sent_by_user_id,
    status: msg.status || 'sent',
    timestamp: msg.timestamp,
    createdAt: msg.created_at,
    reactions: reactionsMap.get(msg.id) || [],
  }
}

/**
 * Batch format messages for fetch route
 */
export function formatMessagesForFetch(
  messages: MessageDbRow[],
  quotedMessages: Map<string, QuotedMessageSimple>,
  reactionsMap: Map<string, ReactionData[]>
) {
  return messages.map((msg) => formatMessageForFetch(msg, quotedMessages, reactionsMap))
}

/**
 * Build quoted message data for conversation format from a database row
 */
export function buildQuotedMessageData(q: MessageDbRow): QuotedMessageData {
  return {
    id: q.id,
    conversationId: q.contact_id,
    senderId: q.sent_by_user_id || q.sender_jid || '',
    senderType: q.from_me ? 'user' : 'contact',
    messageType: q.message_type,
    content: q.content || '',
    isDeleted: q.deleted_by_sender || !!q.deleted_at,
    status: q.status || (q.from_me ? 'sent' : 'delivered'),
    createdAt: q.created_at,
    updatedAt: q.created_at,
  }
}
