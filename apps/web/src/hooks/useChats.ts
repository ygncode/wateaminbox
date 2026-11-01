import {
  type InfiniteData,
  infiniteQueryOptions,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import { toDate } from "@wateaminbox/shared";
import {
  api,
  buildQueryString,
  fetchApi,
  getAccessToken,
  getCompanyId,
} from "@/lib/api/client";
import {
  type ContactsListResponse,
  transformContactToChat,
} from "@/lib/api/transformers";
import type { Chat } from "@/types/chat";
import { queryKeys } from "./query-keys";
import {
  CHAT_PAGE_SIZE,
  CHAT_WINDOW_PAGES,
  previousChatOffset,
} from "./chat-list-window";

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

export function buildChatListQueryParams(
  searchQuery: string,
  includeGroups: boolean,
  assignmentFilter: AssignmentFilter,
  connectionId?: string,
  conversationStatus: ConversationStatusFilter = "open",
  tagIds: readonly string[] = [],
  offset?: number,
  channelAccountId?: string,
): Record<string, unknown> {
  const params: Record<string, unknown> = { limit: CHAT_PAGE_SIZE };
  if (offset !== undefined) params.offset = offset;
  if (searchQuery.trim()) params.search = searchQuery;
  if (includeGroups) params.includeGroups = "true";
  if (connectionId) params.connectionId = connectionId;
  if (channelAccountId) params.channelAccountId = channelAccountId;
  if (tagIds.length > 0) params.tagIds = tagIds.join(",");
  if (assignmentFilter === "assignedToMe") {
    params.assignedToMe = "true";
  } else if (assignmentFilter === "unassigned") {
    params.unassigned = "true";
  } else if (assignmentFilter === "unread") {
    params.unreadOnly = "true";
  }
  params.conversationStatus = conversationStatus;
  return params;
}

export interface ChatListPage {
  chats: Chat[];
  nextOffset: number | undefined;
}

export function selectChatPages(
  data: InfiniteData<ChatListPage, number>,
): Chat[] {
  // Activity can move a chat between offset pages while the user is scrolling.
  // Keep the first (newest) copy rather than rendering duplicate rows/keys.
  const chats = new Map<string, Chat>();
  for (const page of data.pages) {
    for (const chat of page.chats) {
      if (!chats.has(chat.id)) chats.set(chat.id, chat);
    }
  }
  return [...chats.values()];
}

export function chatListQueryOptions(
  searchQuery: string = "",
  includeGroups: boolean = true,
  assignmentFilter: AssignmentFilter = "all",
  connectionId?: string,
  conversationStatus: ConversationStatusFilter = "open",
  tagIds: readonly string[] = [],
  channelAccountId?: string,
) {
  const companyId = getCompanyId();

  return infiniteQueryOptions({
    queryKey: chatKeys.infiniteList({
      search: searchQuery,
      includeGroups,
      assignmentFilter,
      connectionId,
      channelAccountId,
      conversationStatus,
      tagIds,
    }),
    initialPageParam: 0,
    maxPages: CHAT_WINDOW_PAGES,
    getPreviousPageParam: (_firstPage, _pages, firstOffset) =>
      previousChatOffset(firstOffset, CHAT_PAGE_SIZE),
    getNextPageParam: (lastPage: ChatListPage) => lastPage.nextOffset,
    select: selectChatPages,
    queryFn: async ({ pageParam, signal }): Promise<ChatListPage> => {
      const token = getAccessToken();
      if (!token) {
        // Not authenticated - return empty array
        // The ProtectedRoute will handle redirect to login
        return { chats: [], nextOffset: undefined };
      }

      if (!companyId) {
        // No company selected - return empty array
        // The ProtectedRoute will handle redirect to company-setup
        return { chats: [], nextOffset: undefined };
      }

      const queryString = buildQueryString(
        buildChatListQueryParams(
          searchQuery,
          includeGroups,
          assignmentFilter,
          connectionId,
          conversationStatus,
          tagIds,
          pageParam,
          channelAccountId,
        ),
      );
      const result = await fetchApi<ContactsListResponse>(
        `/contacts${queryString}`,
        { signal },
      );

      // Filtering happens before server pagination, including merged unread counts.
      const chats = result.data.map(transformContactToChat);

      return {
        chats,
        // Advance by the server page, not by client-visible or deduplicated rows.
        nextOffset:
          result.pagination.hasMore && result.data.length > 0
            ? result.pagination.offset + result.data.length
            : undefined,
      };
    },
    staleTime: 1000 * 30, // 30 seconds
    gcTime: 1000 * 60 * 5, // 5 minutes
  });
}

/** Paginated inbox data, exposed as a flat array for existing consumers. */
export function useChats(
  searchQuery = "",
  includeGroups = true,
  assignmentFilter: AssignmentFilter = "all",
  connectionId?: string,
  conversationStatus: ConversationStatusFilter = "open",
  tagIds: readonly string[] = [],
  channelAccountId?: string,
) {
  return useInfiniteQuery(
    chatListQueryOptions(
      searchQuery,
      includeGroups,
      assignmentFilter,
      connectionId,
      conversationStatus,
      tagIds,
      channelAccountId,
    ),
  );
}

/** The shell's badge must not follow the sidebar's moving page window. */
export function inboxHeadQueryOptions() {
  const options = chatListQueryOptions();
  return {
    ...options,
    queryKey: chatKeys.infiniteList({ ...options.queryKey[4], headOnly: true }),
    maxPages: 1,
  };
}

export function useInboxHeadChats() {
  return useInfiniteQuery(inboxHeadQueryOptions());
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
