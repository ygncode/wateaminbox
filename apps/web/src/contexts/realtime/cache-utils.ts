/**
 * realtime cache update utilities
 *
 * Provides reusable functions for updating TanStack Query cache
 * in response to realtime events. Extracted from event-handlers.ts
 * to reduce code duplication and improve maintainability.
 */

import type { QueryClient } from "@tanstack/react-query";
import type { Message, PaginatedMessages } from "@wateaminbox/shared";
import { chatKeys } from "../../hooks/useChats";
import { infiniteMessageKeys } from "../../hooks/useInfiniteMessages";

/** Typed infinite query data structure */
export type InfiniteMessageData = {
  pages: PaginatedMessages[];
  pageParams: (string | undefined)[];
};

/**
 * Update a specific message in the infinite messages cache.
 * Applies the updater function to the matching message across all pages.
 *
 * @param queryClient - TanStack Query client
 * @param conversationId - The conversation containing the message
 * @param messageId - The message ID to update
 * @param updater - Function that receives the message and returns the updated message
 * @returns true if the message was found and updated, false otherwise
 */
export function updateMessageInCache(
  queryClient: QueryClient,
  conversationId: string,
  messageId: string,
  updater: (message: Message) => Message,
): boolean {
  const queryKey = infiniteMessageKeys.list(conversationId);
  let messageFound = false;

  queryClient.setQueryData(
    queryKey,
    (oldData: InfiniteMessageData | undefined) => {
      if (!oldData) return oldData;

      const newPages = oldData.pages.map((page) => ({
        ...page,
        messages: page.messages.map((msg) => {
          if (msg.id === messageId) {
            messageFound = true;
            return updater(msg);
          }
          return msg;
        }),
      }));

      return {
        ...oldData,
        pages: newPages,
      };
    },
  );

  return messageFound;
}

/**
 * Add a new message to the infinite messages cache.
 * The message is added to the first page (most recent).
 * Includes duplicate checking by default.
 *
 * @param queryClient - TanStack Query client
 * @param conversationId - The conversation to add the message to
 * @param message - The message to add
 * @param options - Additional options
 * @returns Object with { added: boolean, isDuplicate: boolean }
 */
export function addMessageToCache(
  queryClient: QueryClient,
  conversationId: string,
  message: Message,
  options: { skipDuplicateCheck?: boolean } = {},
): { added: boolean; isDuplicate: boolean } {
  const queryKey = infiniteMessageKeys.list(conversationId);
  let isDuplicate = false;
  let added = false;

  queryClient.setQueryData(
    queryKey,
    (oldData: InfiniteMessageData | undefined) => {
      if (!oldData) return oldData;

      // Check for duplicates unless explicitly skipped
      if (!options.skipDuplicateCheck) {
        const messageExists = oldData.pages.some((page) =>
          page.messages.some((msg) => msg.id === message.id),
        );
        if (messageExists) {
          isDuplicate = true;
          return oldData;
        }
      }

      // Add the new message to the first page (most recent)
      const newPages = [...oldData.pages];
      if (newPages.length > 0) {
        newPages[0] = {
          ...newPages[0],
          messages: [message, ...newPages[0].messages],
        };
        added = true;
      }

      return {
        ...oldData,
        pages: newPages,
      };
    },
  );

  return { added, isDuplicate };
}

/**
 * Update a contact in the chat list cache.
 * Applies the updater function to the contact matching the given JID.
 *
 * @param queryClient - TanStack Query client
 * @param jid - The contact's JID to update
 * @param updater - Function that receives the contact and returns the updated contact
 */
export function updateContactInChatList(
  queryClient: QueryClient,
  jid: string,
  updater: (contact: Record<string, unknown>) => Record<string, unknown>,
): void {
  queryClient.setQueriesData(
    { queryKey: chatKeys.lists() },
    (oldData: unknown) => {
      if (!oldData || !Array.isArray(oldData)) return oldData;
      return oldData.map((chat: Record<string, unknown>) => {
        const contact = chat.contact as Record<string, unknown> | undefined;
        if (contact?.jid === jid) {
          return {
            ...chat,
            contact: updater(contact),
          };
        }
        return chat;
      });
    },
  );
}

/**
 * Invalidate chat list queries to trigger a refetch.
 * Use this after operations that change unread counts or message previews.
 *
 * @param queryClient - TanStack Query client
 */
export function invalidateChatList(queryClient: QueryClient): void {
  queryClient.invalidateQueries({
    queryKey: chatKeys.lists(),
  });
}

/**
 * Force refetch active message queries for a conversation.
 * Use this to ensure UI updates immediately after cache mutations.
 *
 * @param queryClient - TanStack Query client
 * @param conversationId - The conversation to refetch
 */
export function refetchConversationMessages(
  queryClient: QueryClient,
  conversationId: string,
): void {
  queryClient.refetchQueries({
    queryKey: infiniteMessageKeys.list(conversationId),
    type: "active",
  });
}
