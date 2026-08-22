/**
 * API Response Transformers
 *
 * Transforms API response data into frontend-specific formats.
 * This centralizes transformation logic to ensure consistency
 * across different hooks and components.
 */

import { toDate } from "@wateaminbox/shared";
import type {
  Chat,
  ConversationLifecycleStatus,
  MessageStatus,
  MessageType,
} from "@/types/chat";

/**
 * Contact API response format from the backend
 */
export interface ContactApiResponse {
  id: string;
  jid: string;
  phoneNumber: string;
  pushName: string;
  username?: string | null;
  customName: string | null;
  displayName: string;
  isGroup: boolean;
  profilePictureUrl: string | null;
  notesShared: string | null;
  lastMessageAt: string | null;
  lastMessage: {
    id: string;
    messageId: string;
    fromMe: boolean;
    messageType: string;
    content: string;
    status: string;
    timestamp: string;
    sentByUserId: string | null;
    sentByUserName: string | null;
  } | null;
  unreadCount: number;
  assignedTo: string | null;
  isOnline: boolean;
  lastSeen: string | null;
  createdAt: string;
  updatedAt: string;
  connection: {
    id: string;
    name: string | null;
    phoneNumber: string | null;
    status: "disconnected" | "pending" | "connected" | "banned" | "error";
  } | null;
  conversationStatus: ConversationLifecycleStatus;
  activeCaseId: string | null;
}

/**
 * Contacts list response with pagination
 */
export interface ContactsListResponse {
  data: ContactApiResponse[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

/**
 * Transforms a contact API response to the Chat format used in the frontend.
 *
 * This function handles:
 * - Contact data mapping
 * - Last message transformation
 * - Date parsing
 * - Null/undefined handling
 *
 * @param contact - The contact API response from the backend
 * @returns A Chat object for use in the frontend
 */
export function transformContactToChat(contact: ContactApiResponse): Chat {
  return {
    id: contact.id,
    contact: {
      id: contact.id,
      jid: contact.jid,
      phoneNumber: contact.phoneNumber || "",
      name: contact.displayName,
      username: contact.username || undefined,
      customName: contact.customName || undefined,
      avatarUrl: contact.profilePictureUrl || undefined,
      isOnline: contact.isOnline,
      lastSeen: contact.lastSeen
        ? (toDate(contact.lastSeen) ?? undefined)
        : undefined,
      isGroup: contact.isGroup,
      connection: contact.connection,
    },
    lastMessage: contact.lastMessage
      ? {
          id: contact.lastMessage.id,
          chatId: contact.id,
          senderId: contact.lastMessage.fromMe ? "me" : contact.id,
          content: contact.lastMessage.content || "",
          type: contact.lastMessage.messageType as MessageType,
          status: contact.lastMessage.status as MessageStatus,
          timestamp: toDate(contact.lastMessage.timestamp) ?? new Date(),
          isFromMe: contact.lastMessage.fromMe,
          sentByUserId: contact.lastMessage.sentByUserId || undefined,
          sentByUserName: contact.lastMessage.sentByUserName || undefined,
        }
      : undefined,
    unreadCount: contact.unreadCount,
    assignedTo: contact.assignedTo || undefined,
    isPinned: false,
    isMuted: false,
    isArchived: false,
    updatedAt: toDate(contact.updatedAt) ?? new Date(),
    conversationStatus: contact.conversationStatus,
    activeCaseId: contact.activeCaseId,
  };
}

/**
 * Transforms an array of contact API responses to Chat format.
 *
 * @param contacts - Array of contact API responses
 * @returns Array of Chat objects
 */
export function transformContactsToChats(
  contacts: ContactApiResponse[],
): Chat[] {
  return contacts.map(transformContactToChat);
}
