import { useQuery } from "@tanstack/react-query";
import { toDate } from "@wateaminbox/shared";
import { useMemo } from "react";
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
 * Chat list filters for query keys
 */
interface ChatListFilters {
  search?: string;
  includeGroups?: boolean;
  assignmentFilter?: AssignmentFilter;
  connectionId?: string;
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
  groups: () => [...queryKeys.chats.all, "groups"] as const,
  groupList: (filters: { search?: string }) =>
    [...queryKeys.chats.all, "groups", filters] as const,
};

export function buildChatListQueryParams(
  searchQuery: string,
  includeGroups: boolean,
  assignmentFilter: AssignmentFilter,
  connectionId?: string,
): Record<string, unknown> {
  const params: Record<string, unknown> = { limit: 100 };
  if (searchQuery.trim()) params.search = searchQuery;
  if (includeGroups) params.includeGroups = "true";
  if (connectionId) params.connectionId = connectionId;
  if (assignmentFilter === "assignedToMe") {
    params.assignedToMe = "true";
  } else if (assignmentFilter === "unassigned") {
    params.unassigned = "true";
  }
  return params;
}

/**
 * Hook to fetch and manage chat list data
 * Supports search filtering, group inclusion, and assignment filtering
 */
export function useChats(
  searchQuery: string = "",
  includeGroups: boolean = true,
  assignmentFilter: AssignmentFilter = "all",
  connectionId?: string,
) {
  const companyId = getCompanyId();

  // Memoize the query key to prevent unnecessary re-renders
  const queryKey = useMemo(
    () =>
      chatKeys.list({
        search: searchQuery,
        includeGroups,
        assignmentFilter,
        connectionId,
      }),
    [companyId, searchQuery, includeGroups, assignmentFilter, connectionId],
  );

  return useQuery<Chat[], Error>({
    queryKey,
    queryFn: async () => {
      const token = getAccessToken();
      if (!token) {
        // Not authenticated - return empty array
        // The ProtectedRoute will handle redirect to login
        return [];
      }

      if (!companyId) {
        // No company selected - return empty array
        // The ProtectedRoute will handle redirect to company-setup
        return [];
      }

      const queryString = buildQueryString(
        buildChatListQueryParams(
          searchQuery,
          includeGroups,
          assignmentFilter,
          connectionId,
        ),
      );
      const result = await api.get<ContactsListResponse>(
        `/contacts${queryString}`,
      );

      // Transform API response to Chat format using centralized transformer
      let chats = result.data.map(transformContactToChat);

      // Filter by unread if needed (client-side filter)
      if (assignmentFilter === "unread") {
        chats = chats.filter((chat) => chat.unreadCount > 0);
      }

      return chats;
    },
    staleTime: 1000 * 30, // 30 seconds
    gcTime: 1000 * 60 * 5, // 5 minutes
  });
}

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
