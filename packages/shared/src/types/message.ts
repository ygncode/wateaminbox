export interface MessageReaction {
  emoji: string;
  reactorJid: string;
  /** Canonical phone number resolved from the reactor's WhatsApp identity. */
  reactorPhoneNumber?: string | null;
  /** Best available saved contact or WhatsApp push name. */
  reactorName?: string | null;
  /** Best available WhatsApp profile picture. */
  reactorAvatarUrl?: string | null;
  /** Whether the reaction came from the connected WhatsApp account. */
  isOwn?: boolean;
  createdAt: Date;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  senderType: SenderType;
  /** WhatsApp participant identity for group messages. */
  senderJid?: string | null;
  /** WhatsApp push name or resolved contact name for group messages. */
  senderName?: string | null;
  /** Cached WhatsApp profile picture for a group participant. */
  senderAvatarUrl?: string | null;
  /** Team member who sent an outbound message from the shared inbox. */
  sentByUserId?: string | null;
  /** Display name resolved for the sending team member. */
  sentByUserName?: string | null;
  /** Profile picture resolved for the sending team member. */
  sentByUserAvatarUrl?: string | null;
  /** Gravatar fallback for the sending team member's profile picture. */
  sentByUserGravatarUrl?: string | null;
  content: string;
  messageType: MessageType;
  status: MessageStatus;
  whatsappMessageId?: string;
  metadata?: MessageMetadata;
  replyToMessageId?: string;
  replyToMessage?: Message;
  isForwarded?: boolean;
  isDeleted?: boolean;
  isStarred?: boolean;
  reactions?: MessageReaction[];
  createdAt: Date;
  updatedAt: Date;
}

export type SenderType = "user" | "contact" | "system";

export type MessageType =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "sticker"
  | "location"
  | "contact"
  | "reaction"
  | "template";

export type MessageStatus =
  | "pending"
  | "sent"
  | "delivered"
  | "read"
  | "failed";

const MESSAGE_STATUS_RANK: Record<Exclude<MessageStatus, "failed">, number> = {
  pending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
};

/**
 * Advance a message status without allowing out-of-order receipts to regress
 * read/delivered messages. A definitive receipt can recover a failed message.
 */
export function advanceMessageStatus(
  current: MessageStatus,
  incoming: MessageStatus,
): MessageStatus {
  if (incoming === "failed") {
    return current === "pending" ? "failed" : current;
  }
  if (current === "failed") return incoming;

  return MESSAGE_STATUS_RANK[incoming] > MESSAGE_STATUS_RANK[current]
    ? incoming
    : current;
}

export type ScheduledMessageStatus =
  | "scheduled"
  | "processing"
  | "sent"
  | "failed"
  | "canceled"
  | "skipped";

/**
 * An outbound message queued for future delivery. Timestamps are ISO 8601 UTC
 * strings; clients convert to local time for display.
 */
export interface ScheduledMessage {
  id: string;
  contactId: string;
  content: string;
  messageType: MessageType;
  /** Presigned URL of the media object; null for text messages */
  mediaUrl: string | null;
  mediaMimeType: string | null;
  mediaFileName: string | null;
  replyToMessageId: string | null;
  scheduledAt: string;
  status: ScheduledMessageStatus;
  attempts: number;
  lastError: string | null;
  sentMessageId: string | null;
  createdBy: string;
  createdByName?: string;
  canceledAt: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Present when this message is one recipient of a bulk broadcast job. */
  bulkJobId: string | null;
  /** Why an ineligible bulk recipient was skipped (status "skipped"). */
  skipReason: string | null;
}

export type MediaDownloadStatus =
  | "pending"
  | "downloading"
  | "completed"
  | "failed"
  | null;

export interface MessageMetadata {
  mediaUrl?: string;
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
  latitude?: number;
  longitude?: number;
  templateName?: string;
  templateVariables?: Record<string, string>;
  thumbnailUrl?: string;
  duration?: number; // For audio/video in seconds
  caption?: string;
  // Deferred media download fields
  mediaPending?: boolean; // True if media needs to be downloaded on-demand
  mediaDownloadStatus?: MediaDownloadStatus;
  // Error-related fields for failed messages
  error?: string; // Error code, e.g., "delivery_timeout", "network_error", "rate_limit"
  errorMessage?: string; // Human-readable error message
  failedAt?: string; // ISO timestamp when the message failed
}

export interface CreateMessageInput {
  conversationId: string;
  senderId: string;
  senderType: SenderType;
  content: string;
  messageType: MessageType;
  metadata?: MessageMetadata;
  replyToMessageId?: string;
}

export interface UpdateMessageInput {
  status?: MessageStatus;
  whatsappMessageId?: string;
  metadata?: MessageMetadata;
  isStarred?: boolean;
  isDeleted?: boolean;
}

export interface WhatsAppConnectionIdentity {
  id: string;
  name: string | null;
  phoneNumber: string | null;
  status: "disconnected" | "pending" | "connected" | "banned" | "error";
}

export interface Contact {
  id: string;
  name: string;
  phoneNumber: string;
  jid?: string;
  avatarUrl?: string;
  username?: string;
  customName?: string;
  isOnline?: boolean;
  lastSeen?: Date;
  about?: string;
  isGroup?: boolean;
  /** WhatsApp account that owns and routes this conversation. */
  connection?: WhatsAppConnectionIdentity | null;
}

export interface GroupParticipant {
  jid: string;
  isAdmin: boolean;
  joinedAt: Date;
}

export interface GroupInfo {
  id: string;
  jid: string;
  name: string;
  displayName: string;
  customName?: string;
  description?: string;
  profilePictureUrl?: string;
  participantCount: number;
  createdBy?: string;
  createdAt: Date;
  participants: GroupParticipant[];
}

export interface Conversation {
  id: string;
  contactId: string;
  contact: Contact;
  lastMessage?: Message;
  unreadCount: number;
  isPinned?: boolean;
  isMuted?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaginatedMessages {
  messages: Message[];
  nextCursor?: string;
  hasMore: boolean;
  remoteHistoryStatus: RemoteHistoryStatus;
}

/**
 * Availability of messages that may still live on the primary WhatsApp
 * device after the locally persisted pages have been exhausted.
 */
export type RemoteHistoryStatus =
  | "unknown"
  | "available"
  | "requesting"
  | "exhausted"
  | "unavailable"
  | "failed";

// WhatsApp can queue an on-demand history page for several minutes even while
// both devices are online. Keep API stale detection and the browser timer in
// lockstep so a delayed, valid page is not presented as a phone failure.
export const REMOTE_HISTORY_RESPONSE_TIMEOUT_MS = 15 * 60_000;
