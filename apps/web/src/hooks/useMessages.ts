import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Message, UpdateMessageInput } from "@whatsapp-web/shared";
import { api } from "../lib/api";
import { infiniteMessageKeys } from "./useInfiniteMessages";

export const messageKeys = {
  all: ["messages"] as const,
  lists: () => [...messageKeys.all, "list"] as const,
  list: (conversationId: string) =>
    [...messageKeys.lists(), conversationId] as const,
  details: () => [...messageKeys.all, "detail"] as const,
  detail: (id: string) => [...messageKeys.details(), id] as const,
};

export function useMessages(conversationId: string | undefined) {
  return useQuery({
    queryKey: messageKeys.list(conversationId || ""),
    queryFn: () =>
      api.get<Message[]>(`/conversations/${conversationId}/messages`),
    enabled: !!conversationId,
    staleTime: 1000 * 30, // 30 seconds
  });
}

export function useMessage(messageId: string | undefined) {
  return useQuery({
    queryKey: messageKeys.detail(messageId || ""),
    queryFn: () => api.get<Message>(`/messages/${messageId}`),
    enabled: !!messageId,
  });
}

interface SendMessageInput {
  contactId: string;
  content: string;
  messageType?: "text" | "image" | "video" | "audio" | "document";
  mediaUrl?: string;
}

export function useSendMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: SendMessageInput) =>
      api.post<{ success: boolean; message: Message }>("/messages", data),
    onMutate: async (newMessage) => {
      // Cancel outgoing refetches for infinite messages query
      await queryClient.cancelQueries({
        queryKey: infiniteMessageKeys.list(newMessage.contactId),
      });

      return { contactId: newMessage.contactId };
    },
    onSettled: (_data, _error, variables) => {
      // Refetch infinite messages after mutation
      queryClient.invalidateQueries({
        queryKey: infiniteMessageKeys.list(variables.contactId),
      });
    },
  });
}

export function useUpdateMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      messageId,
      data,
    }: {
      messageId: string;
      data: UpdateMessageInput;
    }) => api.patch<Message>(`/messages/${messageId}`, data),
    onSuccess: (updatedMessage) => {
      // Update the message in the cache
      queryClient.setQueryData<Message[]>(
        messageKeys.list(updatedMessage.conversationId),
        (old) =>
          old?.map((msg) =>
            msg.id === updatedMessage.id ? updatedMessage : msg,
          ) || [],
      );
    },
  });
}

export function useDeleteMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      messageId,
      conversationId: _conversationId,
    }: {
      messageId: string;
      conversationId: string;
    }) => api.delete<void>(`/messages/${messageId}`),
    onSuccess: (_data, variables) => {
      // Soft delete - mark as deleted
      queryClient.setQueryData<Message[]>(
        messageKeys.list(variables.conversationId),
        (old) =>
          old?.map((msg) =>
            msg.id === variables.messageId ? { ...msg, isDeleted: true } : msg,
          ) || [],
      );
    },
  });
}

export function useStarMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      messageId,
      isStarred,
    }: {
      messageId: string;
      conversationId: string;
      isStarred: boolean;
    }) => api.patch<Message>(`/messages/${messageId}`, { isStarred }),
    onMutate: async ({ messageId, conversationId, isStarred }) => {
      await queryClient.cancelQueries({
        queryKey: messageKeys.list(conversationId),
      });

      const previousMessages = queryClient.getQueryData<Message[]>(
        messageKeys.list(conversationId),
      );

      queryClient.setQueryData<Message[]>(
        messageKeys.list(conversationId),
        (old) =>
          old?.map((msg) =>
            msg.id === messageId ? { ...msg, isStarred } : msg,
          ) || [],
      );

      return { previousMessages, conversationId };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousMessages) {
        queryClient.setQueryData(
          messageKeys.list(context.conversationId),
          context.previousMessages,
        );
      }
    },
  });
}
