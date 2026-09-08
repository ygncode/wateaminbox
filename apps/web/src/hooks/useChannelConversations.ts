import { useQuery } from "@tanstack/react-query";
import {
  getChannelConversations,
  getChannelMessages,
} from "@/lib/api/channel-conversations";
import { queryKeys } from "./query-keys";

export function useChannelConversations(limit = 50) {
  return useQuery({
    queryKey: queryKeys.channelConversations.list({ limit }),
    queryFn: () => getChannelConversations({ limit }),
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
