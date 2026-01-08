import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Message, UpdateMessageInput } from "@whatsapp-web/shared";
import { toDbDate, nowMs } from "@whatsapp-web/shared";
import { api } from "../lib/api";
import { infiniteMessageKeys } from "./useInfiniteMessages";
import { queryKeys } from "./query-keys";

/**
 * @deprecated Use `queryKeys.messages` from `@/hooks/query-keys` instead.
 * Kept for backward compatibility.
 */
export const messageKeys = {
  all: queryKeys.messages.all,
  lists: () => queryKeys.messages.lists(),
  list: (conversationId: string) => queryKeys.messages.list({ conversationId }),
  details: () => queryKeys.messages.details(),
  detail: (id: string) => queryKeys.messages.detail(id),
};

export function useMessages(conversationId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.messages.list({ conversationId: conversationId ?? "" }),
    queryFn: () =>
      api.get<Message[]>(`/conversations/${conversationId}/messages`),
    enabled: !!conversationId,
    staleTime: 1000 * 30, // 30 seconds
  });
}

export function useMessage(messageId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.messages.detail(messageId ?? ""),
    queryFn: () => api.get<Message>(`/messages/${messageId}`),
    enabled: !!messageId,
  });
}

interface SendMessageInput {
  contactId: string;
  content: string;
  messageType?: "text" | "image" | "video" | "audio" | "document";
  mediaUrl?: string;
  replyToMessageId?: string;
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

      // Create an optimistic message
      const now = toDbDate();
      const optimisticMessage: Message = {
        id: `optimistic-${nowMs()}`,
        conversationId: newMessage.contactId,
        senderId: "current-user",
        senderType: "user",
        messageType: newMessage.messageType || "text",
        content: newMessage.content,
        metadata: newMessage.mediaUrl
          ? { mediaUrl: newMessage.mediaUrl }
          : undefined,
        replyToMessageId: newMessage.replyToMessageId,
        isStarred: false,
        isDeleted: false,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      };

      // Optimistically add the message to the cache
      const queryKey = infiniteMessageKeys.list(newMessage.contactId);
      const previousData = queryClient.getQueryData(queryKey);

      queryClient.setQueryData<{
        pages: {
          messages: Message[];
          hasMore: boolean;
          nextCursor: string | null;
        }[];
        pageParams: (string | undefined)[];
      }>(queryKey, (oldData) => {
        if (!oldData) return oldData;

        const newPages = [...oldData.pages];
        if (newPages.length > 0) {
          newPages[0] = {
            ...newPages[0],
            messages: [optimisticMessage, ...newPages[0].messages],
          };
        }

        return {
          ...oldData,
          pages: newPages,
        };
      });

      return {
        contactId: newMessage.contactId,
        previousData,
        optimisticId: optimisticMessage.id,
      };
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
      queryClient.setQueryData<{
        pages: {
          messages: Message[];
          hasMore: boolean;
          nextCursor: string | null;
        }[];
        pageParams: (string | undefined)[];
      }>(infiniteMessageKeys.list(conversationId), (oldData) => {
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
      });

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

interface RetryMessageResponse {
  success: boolean;
  message: Message;
  originalMessageId: string;
}

export function useRetryMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (messageId: string) =>
      api.post<RetryMessageResponse>(`/messages/${messageId}/retry`, {}),
    onSuccess: (data, _variables) => {
      // Invalidate the messages query to show the new retried message
      queryClient.invalidateQueries({
        queryKey: infiniteMessageKeys.list(data.message.conversationId),
      });
    },
  });
}

export function useReactMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      messageId,
      emoji,
    }: {
      messageId: string;
      conversationId: string;
      emoji: string;
      userJid?: string;
    }) =>
      api.post<{ success: boolean }>(`/messages/${messageId}/reaction`, {
        emoji,
      }),
    onMutate: async (variables) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({
        queryKey: infiniteMessageKeys.list(variables.conversationId),
      });

      // Snapshot previous value for rollback
      const previousData = queryClient.getQueryData(
        infiniteMessageKeys.list(variables.conversationId),
      );

      // Optimistically update the reaction in the infinite messages cache
      // Use userJid if provided, otherwise use 'current-user' as a placeholder
      const reactorJid = variables.userJid || "current-user";

      queryClient.setQueryData<{
        pages: {
          messages: Message[];
          hasMore: boolean;
          nextCursor: string | null;
        }[];
        pageParams: (string | undefined)[];
      }>(infiniteMessageKeys.list(variables.conversationId), (oldData) => {
        if (!oldData) return oldData;

        return {
          ...oldData,
          pages: oldData.pages.map((page) => ({
            ...page,
            messages: page.messages.map((msg) => {
              if (msg.id !== variables.messageId) return msg;

              const currentReactions = msg.reactions || [];

              // If emoji is empty, remove the reaction
              if (!variables.emoji) {
                return {
                  ...msg,
                  reactions: currentReactions.filter(
                    (r) => r.reactorJid !== reactorJid,
                  ),
                };
              }

              // Check if user already has a reaction
              const existingIndex = currentReactions.findIndex(
                (r) => r.reactorJid === reactorJid,
              );

              if (existingIndex >= 0) {
                // Update existing reaction
                const updatedReactions = [...currentReactions];
                updatedReactions[existingIndex] = {
                  ...updatedReactions[existingIndex],
                  emoji: variables.emoji,
                  createdAt: new Date(),
                };
                return { ...msg, reactions: updatedReactions };
              }

              // Add new reaction
              return {
                ...msg,
                reactions: [
                  ...currentReactions,
                  {
                    emoji: variables.emoji,
                    reactorJid,
                    createdAt: new Date(),
                  },
                ],
              };
            }),
          })),
        };
      });

      return { previousData, conversationId: variables.conversationId };
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
    onSuccess: (_data, variables) => {
      // Invalidate to ensure we have the server's version
      queryClient.invalidateQueries({
        queryKey: infiniteMessageKeys.list(variables.conversationId),
      });
      // Also invalidate regular message list
      queryClient.invalidateQueries({
        queryKey: queryKeys.messages.list({
          conversationId: variables.conversationId,
        }),
      });
    },
  });
}

interface MediaDownloadResponse {
  status: "downloading" | "completed";
  mediaUrl?: string;
}

export function useRequestMediaDownload() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      messageId,
    }: {
      messageId: string;
      conversationId: string;
    }) => api.post<MediaDownloadResponse>(`/media/download/${messageId}`, {}),
    onMutate: async ({ messageId, conversationId }) => {
      // Optimistically update the message status to downloading
      await queryClient.cancelQueries({
        queryKey: infiniteMessageKeys.list(conversationId),
      });

      const previousData = queryClient.getQueryData(
        infiniteMessageKeys.list(conversationId),
      );

      queryClient.setQueryData<{
        pages: {
          messages: Message[];
          hasMore: boolean;
          nextCursor: string | null;
        }[];
        pageParams: (string | undefined)[];
      }>(infiniteMessageKeys.list(conversationId), (oldData) => {
        if (!oldData) return oldData;

        return {
          ...oldData,
          pages: oldData.pages.map((page) => ({
            ...page,
            messages: page.messages.map((msg) =>
              msg.id === messageId
                ? {
                    ...msg,
                    metadata: {
                      ...msg.metadata,
                      mediaDownloadStatus: "downloading" as const,
                    },
                  }
                : msg,
            ),
          })),
        };
      });

      return { previousData, conversationId };
    },
    onSuccess: (data, variables) => {
      // If already completed, update the cache with the media URL
      if (data.status === "completed" && data.mediaUrl) {
        queryClient.setQueryData<{
          pages: {
            messages: Message[];
            hasMore: boolean;
            nextCursor: string | null;
          }[];
          pageParams: (string | undefined)[];
        }>(infiniteMessageKeys.list(variables.conversationId), (oldData) => {
          if (!oldData) return oldData;

          return {
            ...oldData,
            pages: oldData.pages.map((page) => ({
              ...page,
              messages: page.messages.map((msg) =>
                msg.id === variables.messageId
                  ? {
                      ...msg,
                      metadata: {
                        ...msg.metadata,
                        mediaUrl: data.mediaUrl,
                        mediaPending: false,
                        mediaDownloadStatus: "completed" as const,
                      },
                    }
                  : msg,
              ),
            })),
          };
        });
      }
      // If status is 'downloading', the WebSocket handler will update when download completes
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

interface ForwardMessageResponse {
  success: boolean;
  forwardedMessageId: string;
  autoAssigned: boolean;
}

export function useForwardMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      messageId,
      targetContactId,
    }: {
      messageId: string;
      sourceConversationId: string;
      targetContactId: string;
    }) =>
      api.post<ForwardMessageResponse>(`/messages/${messageId}/forward`, {
        targetContactId,
      }),
    onSuccess: (_data, variables) => {
      // Invalidate both source and target conversation message lists
      queryClient.invalidateQueries({
        queryKey: infiniteMessageKeys.list(variables.sourceConversationId),
      });
      queryClient.invalidateQueries({
        queryKey: infiniteMessageKeys.list(variables.targetContactId),
      });
      // Also invalidate chat list to update last message
      queryClient.invalidateQueries({
        queryKey: ["chats"],
      });
    },
  });
}
