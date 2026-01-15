import { useQuery } from "@tanstack/react-query";
import type { Message } from "@whatsapp-web/shared";
import { api } from "../../lib/api";
import { queryKeys } from "../query-keys";

/**
 * Fetch all messages for a conversation
 */
export function useMessages(conversationId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.messages.list({ conversationId: conversationId ?? "" }),
    queryFn: () =>
      api.get<Message[]>(`/conversations/${conversationId}/messages`),
    enabled: !!conversationId,
    staleTime: 1000 * 30, // 30 seconds
    gcTime: 1000 * 60 * 5, // 5 minutes
  });
}

/**
 * Fetch a single message by ID
 */
export function useMessage(messageId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.messages.detail(messageId ?? ""),
    queryFn: () => api.get<Message>(`/messages/${messageId}`),
    enabled: !!messageId,
  });
}
