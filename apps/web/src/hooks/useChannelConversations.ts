import { useQuery } from "@tanstack/react-query";
import {
  getChannelConversation,
  getChannelConversations,
  getChannelMessages,
} from "@/lib/api/channel-conversations";
import { ApiRequestError } from "@/lib/api/client";
import { queryKeys } from "./query-keys";

export function useChannelConversations(
  limit = 50,
  tagIds: readonly string[] = [],
) {
  return useQuery({
    queryKey: queryKeys.channelConversations.list({ limit, tagIds }),
    queryFn: async () => {
      try {
        return await getChannelConversations({ limit, tagIds });
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
