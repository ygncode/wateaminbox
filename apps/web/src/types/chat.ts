/**
 * Chat-related type definitions for the wateaminbox application
 *
 * This file provides frontend-specific view models and re-exports shared types.
 */

import type {
  Contact as SharedContact,
  GroupInfo as SharedGroupInfo,
  GroupParticipant as SharedGroupParticipant,
  MessageType as SharedMessageType,
} from "@wateaminbox/shared";

/**
 * Message status with frontend-specific "sending" state
 */
export type MessageStatus =
  | "sending"
  | "sent"
  | "delivered"
  | "read"
  | "failed";

/**
 * Re-export Contact from shared (now includes about and isGroup fields)
 */
export type Contact = SharedContact;

/**
 * Re-export GroupInfo from shared
 */
export type GroupInfo = SharedGroupInfo;

/**
 * Re-export GroupParticipant from shared
 */
export type GroupParticipant = SharedGroupParticipant;

/**
 * Message type - extends shared type with "contact"
 */
export type MessageType = SharedMessageType | "contact";

export interface Message {
  id: string;
  chatId: string;
  senderId: string;
  content: string;
  type: MessageType;
  status: MessageStatus;
  timestamp: Date;
  isFromMe: boolean;
  sentByUserId?: string;
  sentByUserName?: string;
  replyToId?: string;
  isForwarded?: boolean;
  isDeleted?: boolean;
  mediaUrl?: string;
  mediaCaption?: string;
  mediaMimeType?: string;
}

export interface Chat {
  id: string;
  contact: Contact;
  lastMessage?: Message;
  unreadCount: number;
  assignedTo?: string;
  isPinned: boolean;
  isMuted: boolean;
  isArchived: boolean;
  updatedAt: Date;
}

export interface ChatListProps {
  selectedChatId?: string;
  onChatSelect: (chatId: string) => void;
  className?: string;
}

export interface ChatListItemProps {
  chat: Chat;
  isSelected: boolean;
  onClick: () => void;
  /** Optional callback to prefetch chat data on hover */
  onPrefetch?: (chatId: string) => void;
}

export interface ChatListSearchProps {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  placeholder?: string;
}
