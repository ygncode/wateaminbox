export interface MessageReaction {
  emoji: string;
  reactorJid: string;
  createdAt: Date;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  senderType: SenderType;
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

export type MessageType = "text" | "image" | "video" | "audio" | "document" | "sticker" | "location" | "template";

export type MessageStatus = "pending" | "sent" | "delivered" | "read" | "failed";

export type MediaDownloadStatus = "pending" | "downloading" | "completed" | "failed" | null;

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

export interface Contact {
  id: string;
  name: string;
  phoneNumber: string;
  jid?: string;
  avatarUrl?: string;
  customName?: string;
  isOnline?: boolean;
  lastSeen?: Date;
  about?: string;
  isGroup?: boolean;
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
}
