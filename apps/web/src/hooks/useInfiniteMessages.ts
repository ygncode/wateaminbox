import { useInfiniteQuery } from "@tanstack/react-query";
import type { PaginatedMessages } from "@wateaminbox/shared";
import { api } from "../lib/api";
import { getCompanyId } from "../lib/api/client";

export const infiniteMessageKeys = {
  get all() {
    return ["infinite-messages", getCompanyId()] as const;
  },
  list: (conversationId: string) =>
    ["infinite-messages", getCompanyId(), conversationId] as const,
};

interface FetchMessagesParams {
  conversationId: string;
  cursor?: string;
  limit?: number;
}

async function fetchMessages({
  conversationId,
  cursor,
  limit = 50,
}: FetchMessagesParams): Promise<PaginatedMessages> {
  const params = new URLSearchParams();
  params.set("limit", limit.toString());
  if (cursor) {
    params.set("cursor", cursor);
  }

  return api.get<PaginatedMessages>(
    `/conversations/${conversationId}/messages?${params.toString()}`,
  );
}

export function useInfiniteMessages(
  conversationId: string | undefined,
  options?: { limit?: number },
) {
  const limit = options?.limit ?? 50;

  return useInfiniteQuery({
    queryKey: infiniteMessageKeys.list(conversationId || ""),
    queryFn: ({ pageParam }) =>
      fetchMessages({
        conversationId: conversationId!,
        cursor: pageParam,
        limit,
      }),
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.nextCursor : undefined,
    initialPageParam: undefined as string | undefined,
    enabled: !!conversationId,
    staleTime: 1000 * 30, // 30 seconds
    gcTime: 1000 * 60 * 5, // 5 minutes
    // Messages are fetched in reverse chronological order
    // So the first page is the most recent messages
    select: (data) => ({
      pages: data.pages,
      pageParams: data.pageParams,
      // Flatten and reverse to get chronological order
      messages: data.pages.flatMap((page) => page.messages).reverse(),
    }),
  });
}

export function useInfiniteMessagesUtils() {
  return {
    // Utility to add a new message to the infinite query cache
    addMessageToCache: (
      conversationId: string,
      queryClient: ReturnType<
        typeof import("@tanstack/react-query").useQueryClient
      >,
    ) => {
      return (newMessage: import("@wateaminbox/shared").Message) => {
        queryClient.setQueryData(
          infiniteMessageKeys.list(conversationId),
          (oldData: ReturnType<typeof useInfiniteMessages>["data"]) => {
            if (!oldData) return oldData;

            // Add the new message to the first page (most recent)
            const newPages = [...oldData.pages];
            if (newPages.length > 0) {
              newPages[0] = {
                ...newPages[0],
                messages: [newMessage, ...newPages[0].messages],
              };
            }

            return {
              ...oldData,
              pages: newPages,
            };
          },
        );
      };
    },
  };
}
