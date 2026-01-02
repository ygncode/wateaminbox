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
  createdAt: Date;
  updatedAt: Date;
}

export type SenderType = "user" | "contact" | "system";

export type MessageType = "text" | "image" | "video" | "audio" | "document" | "location" | "template";

export type MessageStatus = "pending" | "sent" | "delivered" | "read" | "failed";

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
