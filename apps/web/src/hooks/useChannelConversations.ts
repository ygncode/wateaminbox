import {
  type InfiniteData,
  infiniteQueryOptions,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import {
  type ChannelConversation,
  getChannelConversation,
  getChannelConversations,
  getChannelMessages,
} from "@/lib/api/channel-conversations";
import { ApiRequestError } from "@/lib/api/client";
import { queryKeys } from "./query-keys";
import { CHAT_WINDOW_PAGES, previousChatOffset } from "./chat-list-window";

function selectChannelConversationPages(
  data: InfiniteData<ChannelConversation[], number>,
) {
  const conversations = new Map<string, ChannelConversation>();
  for (const page of data.pages) {
    for (const conversation of page) {
      if (!conversations.has(conversation.id)) {
        conversations.set(conversation.id, conversation);
      }
    }
  }
  return [...conversations.values()];
}

export function channelConversationListOptions(
  limit = 50,
  tagIds: readonly string[] = [],
  scope: Record<string, string> = {},
) {
  return infiniteQueryOptions({
    queryKey: [
      ...queryKeys.channelConversations.lists(),
      "infinite",
      { limit, tagIds, scope },
    ],
    initialPageParam: 0,
    maxPages: CHAT_WINDOW_PAGES,
    getPreviousPageParam: (_firstPage, _pages, firstOffset) =>
      previousChatOffset(firstOffset, limit),
    getNextPageParam: (lastPage: ChannelConversation[], _pages, lastOffset) =>
      lastPage.length === limit ? lastOffset + lastPage.length : undefined,
    select: selectChannelConversationPages,
    queryFn: async ({ pageParam, signal }) => {
      try {
        return await getChannelConversations(
          {
            limit,
            tagIds,
            offset: pageParam,
            channelAccountId:
              scope.accountFilter && scope.accountFilter !== "all"
                ? scope.accountFilter
                : undefined,
            unreadOnly: scope.assignmentFilter === "unread" ? true : undefined,
          },
          signal,
        );
      } catch (error) {
        if (error instanceof ApiRequestError && error.statusCode === 404) {
          return [];
        }
        throw error;
      }
    },
    staleTime: 30_000,
  });
}

export function useChannelConversations(
  limit = 50,
  tagIds: readonly string[] = [],
  scope: Record<string, string> = {},
) {
  return useInfiniteQuery(channelConversationListOptions(limit, tagIds, scope));
}

export function useChannelConversation(
  conversationId: string | null | undefined,
) {
  return useQuery({
    queryKey: queryKeys.channelConversations.detail(conversationId ?? ""),
    queryFn: async () => {
      try {
        return await getChannelConversation(conversationId!);
      } catch (error) {
        if (error instanceof ApiRequestError && error.statusCode === 404) {
          return null;
        }
        throw error;
      }
    },
    enabled: Boolean(conversationId),
    staleTime: 30_000,
  });
}

export function useChannelMessages(
  conversationId: string | null | undefined,
  options: { limit?: number; cursor?: string } = {},
) {
  const { limit = 50, cursor } = options;
  return useQuery({
    queryKey: queryKeys.channelMessages.list({
      conversationId: conversationId ?? "",
      limit,
      cursor,
    }),
    queryFn: () => getChannelMessages(conversationId!, { limit, cursor }),
    enabled: Boolean(conversationId),
    staleTime: 30_000,
  });
}
