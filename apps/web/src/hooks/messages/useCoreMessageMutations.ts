import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Message, UpdateMessageInput } from "@wateaminbox/shared";
import { api } from "../../lib/api";
import { queryKeys } from "../query-keys";
import { infiniteMessageKeys } from "../useInfiniteMessages";
import {
  createOptimisticMessage,
  prependOptimisticMessage,
  reconcileOptimisticMessage,
} from "./optimistic-message";
import type { InfiniteMessagesData, SendMessageInput } from "./types";

/**
 * Send a new message
 */
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

      const optimisticMessage = createOptimisticMessage(newMessage);

      // Optimistically add the message to the cache
      const queryKey = infiniteMessageKeys.list(newMessage.contactId);
      const previousData = queryClient.getQueryData(queryKey);

      queryClient.setQueryData<InfiniteMessagesData>(queryKey, (oldData) =>
        prependOptimisticMessage(oldData, optimisticMessage),
      );

      return {
        contactId: newMessage.contactId,
        previousData,
        optimisticId: optimisticMessage.id,
      };
    },
    onSuccess: (response, variables, context) => {
      if (!context?.optimisticId) return;
      queryClient.setQueryData<InfiniteMessagesData>(
        infiniteMessageKeys.list(variables.contactId),
        (oldData) =>
          reconcileOptimisticMessage(
            oldData,
            context.optimisticId,
            response.message,
          ),
      );
    },
    onError: (_error, variables, context) => {
      // Rollback on error
      if (context?.previousData) {
        queryClient.setQueryData(
          infiniteMessageKeys.list(variables.contactId),
          context.previousData,
        );
      }
    },
    onSettled: (_data, _error, variables) => {
      // Refetch infinite messages after mutation to get the real message
      queryClient.invalidateQueries({
        queryKey: infiniteMessageKeys.list(variables.contactId),
      });
    },
  });
}

/**
 * Update an existing message
 */
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
        queryKeys.messages.list({
          conversationId: updatedMessage.conversationId,
        }),
        (old) =>
          old?.map((msg) =>
            msg.id === updatedMessage.id ? updatedMessage : msg,
          ) || [],
      );
    },
  });
}

/**
 * Delete a message
 */
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
    onMutate: async ({ messageId, conversationId }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({
        queryKey: infiniteMessageKeys.list(conversationId),
      });

      // Snapshot previous value for rollback
      const previousData = queryClient.getQueryData(
        infiniteMessageKeys.list(conversationId),
      );

      // Optimistically update the infinite messages cache
      queryClient.setQueryData<InfiniteMessagesData>(
        infiniteMessageKeys.list(conversationId),
        (oldData) => {
          if (!oldData) return oldData;

          return {
            ...oldData,
            pages: oldData.pages.map((page) => ({
              ...page,
              messages: page.messages.map((msg) =>
                msg.id === messageId ? { ...msg, isDeleted: true } : msg,
              ),
            })),
          };
        },
      );

      // Also update legacy message list cache if it exists
      queryClient.setQueryData<Message[]>(
        queryKeys.messages.list({ conversationId }),
        (old) =>
          old?.map((msg) =>
            msg.id === messageId ? { ...msg, isDeleted: true } : msg,
          ) || [],
      );

      return { previousData, conversationId };
    },
    onError: (_error, variables, context) => {
      // Rollback on error
      if (context?.previousData) {
        queryClient.setQueryData(
          infiniteMessageKeys.list(variables.conversationId),
          context.previousData,
        );
      }
    },
  });
}

/**
 * Star/unstar a message
 */
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
        queryKey: queryKeys.messages.list({ conversationId }),
      });

      const previousMessages = queryClient.getQueryData<Message[]>(
        queryKeys.messages.list({ conversationId }),
      );

      queryClient.setQueryData<Message[]>(
        queryKeys.messages.list({ conversationId }),
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
          queryKeys.messages.list({ conversationId: context.conversationId }),
          context.previousMessages,
        );
      }
    },
  });
}
