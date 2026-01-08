import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { infiniteMessageKeys } from "../useInfiniteMessages";
import type { MediaDownloadResponse, ForwardMessageResponse, InfiniteMessagesData } from "./types";

/**
 * Request media download for a message
 */
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

      queryClient.setQueryData<InfiniteMessagesData>(
        infiniteMessageKeys.list(conversationId),
        (oldData) => {
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
        },
      );

      return { previousData, conversationId };
    },
    onSuccess: (data, variables) => {
      // If already completed, update the cache with the media URL
      if (data.status === "completed" && data.mediaUrl) {
        queryClient.setQueryData<InfiniteMessagesData>(
          infiniteMessageKeys.list(variables.conversationId),
          (oldData) => {
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
          },
        );
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

/**
 * Forward a message to another contact
 */
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
