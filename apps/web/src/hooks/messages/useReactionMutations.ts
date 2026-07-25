import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { infiniteMessageKeys } from "../useInfiniteMessages";
import type { InfiniteMessagesData, RetryMessageResponse } from "./types";

const OPTIMISTIC_REACTOR_JID = "current-user";

interface ReactionResponse {
  emoji: string;
  reactorJid: string;
  isOwn: boolean;
}

/**
 * Retry sending a failed message
 */
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

/**
 * Add/remove reaction from a message
 */
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
      api.post<ReactionResponse>(`/messages/${messageId}/reaction`, {
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

      // Optimistically update the reaction in the infinite messages cache.
      // The API response replaces this placeholder with the WhatsApp JID.
      const reactorJid = variables.userJid || OPTIMISTIC_REACTOR_JID;

      queryClient.setQueryData<InfiniteMessagesData>(
        infiniteMessageKeys.list(variables.conversationId),
        (oldData) => {
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
                      isOwn: true,
                      createdAt: new Date(),
                    },
                  ],
                };
              }),
            })),
          };
        },
      );

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
    onSuccess: (reaction, variables) => {
      // The realtime event can arrive before the HTTP response. Reconcile the
      // optimistic placeholder with the real JID so both entries are not
      // rendered as two reactions from different users.
      queryClient.setQueryData<InfiniteMessagesData>(
        infiniteMessageKeys.list(variables.conversationId),
        (oldData) => {
          if (!oldData) return oldData;

          return {
            ...oldData,
            pages: oldData.pages.map((page) => ({
              ...page,
              messages: page.messages.map((msg) => {
                if (msg.id !== variables.messageId) return msg;

                const otherReactions = (msg.reactions || []).filter(
                  (item) =>
                    item.reactorJid !== OPTIMISTIC_REACTOR_JID &&
                    item.reactorJid !== reaction.reactorJid,
                );

                return {
                  ...msg,
                  reactions: [
                    ...otherReactions,
                    {
                      emoji: reaction.emoji,
                      reactorJid: reaction.reactorJid,
                      isOwn: reaction.isOwn,
                      createdAt: new Date(),
                    },
                  ],
                };
              }),
            })),
          };
        },
      );
    },
  });
}
