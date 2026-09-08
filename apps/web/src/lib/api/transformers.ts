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
    mentionParticipants?: {
      displayName: string;
      mentionIds: string[];
    }[];
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
  conversationId?: string | null;
  channel?: string | null;
  provider?: string | null;
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
      conversationId: contact.conversationId,
      channel: contact.channel,
      provider: contact.provider,
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
          mentionParticipants: contact.lastMessage.mentionParticipants,
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

export function transformChannelConversationToChat(conversation: {
  id: string;
  channel: string;
  provider: string;
  kind: "direct" | "group" | "thread";
  subject: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  conversationStatus: ConversationLifecycleStatus;
  legacyContactId: string | null;
}): Chat {
  const name = conversation.subject?.trim() || conversation.channel;
  return {
    id: conversation.legacyContactId ?? conversation.id,
    contact: {
      id: conversation.legacyContactId ?? conversation.id,
      jid: undefined,
      phoneNumber: "",
      name,
      isGroup: conversation.kind !== "direct",
      conversationId: conversation.id,
      channel: conversation.channel,
      provider: conversation.provider,
    },
    lastMessage: conversation.lastMessagePreview
      ? {
          id: `${conversation.id}:preview`,
          chatId: conversation.legacyContactId ?? conversation.id,
          senderId: conversation.id,
          content: conversation.lastMessagePreview,
          type: "text",
          status: "delivered",
          timestamp: toDate(conversation.lastMessageAt) ?? new Date(),
          isFromMe: false,
        }
      : undefined,
    unreadCount: conversation.unreadCount,
    isPinned: false,
    isMuted: false,
    isArchived: false,
    updatedAt: toDate(conversation.lastMessageAt) ?? new Date(),
    conversationStatus: conversation.conversationStatus,
    activeCaseId: null,
  };
}

export function mergeInboxChats(
  contactChats: Chat[],
  conversations: Parameters<typeof transformChannelConversationToChat>[0][],
): Chat[] {
  const seenContacts = new Set(contactChats.map((chat) => chat.id));
  const seenConversations = new Set(
    contactChats
      .map((chat) => chat.contact.conversationId)
      .filter((id): id is string => Boolean(id)),
  );
  const extras = conversations
    .filter(
      (conversation) =>
        !seenConversations.has(conversation.id) &&
        (!conversation.legacyContactId ||
          !seenContacts.has(conversation.legacyContactId)),
    )
    .map(transformChannelConversationToChat);
  return [...contactChats, ...extras].sort(
    (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
  );
}
