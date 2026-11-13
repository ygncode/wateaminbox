import { useQuery } from "@tanstack/react-query";
import { toDate } from "@wateaminbox/shared";
import {
  api,
  buildQueryString,
  getAccessToken,
  getCompanyId,
} from "@/lib/api/client";
import {
  type ContactsListResponse,
  transformContactToChat,
} from "@/lib/api/transformers";
import type { Chat } from "@/types/chat";
import { queryKeys } from "./query-keys";

/**
 * Assignment filter type
 */
export type AssignmentFilter = "all" | "assignedToMe" | "unassigned" | "unread";

/**
 * Conversation lifecycle filter. Defaults to "open" - the common inbox
 * default, with Pending/Resolved/All one tap away (see ChatSidebar).
 */
export type ConversationStatusFilter = "open" | "pending" | "resolved" | "all";

/**
 * Chat list filters for query keys
 */
interface ChatListFilters {
  search?: string;
  includeGroups?: boolean;
  assignmentFilter?: AssignmentFilter;
  connectionId?: string;
  channelAccountId?: string;
  conversationStatus?: ConversationStatusFilter;
  tagIds?: readonly string[];
  headOnly?: boolean;
}

/**
 * Extended query keys for chats with custom patterns
 * Uses the base queryKeys.chats and extends with chat-specific keys
 */
export const chatKeys = {
  get all() {
    return queryKeys.chats.all;
  },
  lists: queryKeys.chats.lists,
  details: queryKeys.chats.details,
  detail: queryKeys.chats.detail,
  list: (filters: ChatListFilters) =>
    [...queryKeys.chats.lists(), filters] as const,
  infiniteList: (filters: ChatListFilters) =>
    [...queryKeys.chats.lists(), "infinite", filters] as const,
  groups: () => [...queryKeys.chats.all, "groups"] as const,
  groupList: (filters: { search?: string }) =>
    [...queryKeys.chats.all, "groups", filters] as const,
};

/**
 * Hook to fetch groups only (returns data as Chat format for chat list compatibility)
 * @deprecated Use useGroups from useGroups.ts for the proper GroupListItem format
 */
export function useGroupsAsChats(searchQuery: string = "") {
  return useQuery<Chat[], Error>({
    queryKey: chatKeys.groupList({ search: searchQuery }),
    queryFn: async () => {
      const token = getAccessToken();
      if (!token) {
        return [];
      }

      const companyId = getCompanyId();
      if (!companyId) {
        return [];
      }

      const params: Record<string, unknown> = {
        limit: 100,
      };
      if (searchQuery.trim()) {
        params.search = searchQuery;
      }

      const queryString = buildQueryString(params);
      const result = await api.get<{
        data: {
          id: string;
          jid: string;
          name: string;
          displayName: string;
          description?: string;
          participantCount?: number;
          profilePictureUrl?: string | null;
          lastMessageAt?: string | null;
          unreadCount: number;
          createdAt: string;
        }[];
      }>(`/groups${queryString}`);

      // Transform API response to Chat format
      return result.data.map(
        (group): Chat => ({
          id: group.id,
          contact: {
            id: group.id,
            phoneNumber: "",
            name: group.displayName,
            customName:
              group.name !== group.displayName ? group.name : undefined,
            avatarUrl: group.profilePictureUrl || undefined,
            isOnline: false,
            isGroup: true,
            about: group.description,
          },
          lastMessage: group.lastMessageAt
            ? {
                id: "",
                chatId: group.id,
                senderId: "",
                content: "",
                type: "text",
                status: "delivered",
                timestamp: toDate(group.lastMessageAt) ?? new Date(),
                isFromMe: false,
              }
            : undefined,
          unreadCount: group.unreadCount,
          isPinned: false,
          isMuted: false,
          isArchived: false,
          updatedAt: toDate(group.createdAt) ?? new Date(),
          // /groups doesn't carry lifecycle data; deprecated in favor of
          // useGroups (useGroups.ts), which is wired into GroupList directly.
          conversationStatus: "open",
          activeCaseId: null,
        }),
      );
    },
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 5,
  });
}

/**
 * Hook to fetch a single chat by ID
 */
export function useChat(chatId: string) {
  return useQuery<Chat | undefined, Error>({
    queryKey: chatKeys.detail(chatId),
    queryFn: async () => {
      const token = getAccessToken();
      const companyId = getCompanyId();
      if (!token || !companyId) {
        return undefined;
      }

      // Fetch single contact and transform to Chat format
      const result = await api.get<ContactsListResponse["data"][0]>(
        `/contacts/${chatId}`,
      );
      return transformContactToChat(result);
    },
    enabled: !!chatId,
    staleTime: 1000 * 60 * 5,
  });
}
