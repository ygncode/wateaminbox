import type { QueryClient } from "@tanstack/react-query";
import type { Message } from "@wateaminbox/shared";
import { updateMessageInCache } from "../../contexts/realtime/cache-utils";
import { queryKeys } from "../query-keys";

/**
 * Writes a star toggle into the message caches.
 *
 * The rendered thread reads `infiniteMessageKeys.list(conversationId)`, which is
 * fed by `useInfiniteMessages`; `queryKeys.messages.list({ conversationId })` is
 * the legacy flat list and has no reader left. Starring used to write only the
 * legacy cache, so the optimistic toggle was invisible: the server stored the
 * change, the thread kept rendering the old state, and nothing refetched the
 * cache the UI actually read. `useDeleteMessage` keeps the same two-cache
 * parity, so staying consistent here is deliberate.
 */
export function setMessageStarredInCaches(
  queryClient: QueryClient,
  params: { conversationId: string; messageId: string; isStarred: boolean },
): void {
  const { conversationId, messageId, isStarred } = params;

  updateMessageInCache(queryClient, conversationId, messageId, (message) => ({
    ...message,
    isStarred,
  }));

  queryClient.setQueryData<Message[]>(
    queryKeys.messages.list({ conversationId }),
    (old) =>
      old?.map((msg) =>
        msg.id === messageId ? { ...msg, isStarred } : msg,
      ) || [],
  );
}
