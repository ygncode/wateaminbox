/**
 * Message hooks - re-exported from messages/ directory for backwards compatibility
 *
 * @module useMessages
 */

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

// Re-export all hooks from the new location
export {
  // Query hooks
  useMessages,
  useMessage,
  // Mutation hooks
  useSendMessage,
  useUpdateMessage,
  useDeleteMessage,
  useStarMessage,
  useRetryMessage,
  useReactMessage,
  useRequestMediaDownload,
  useForwardMessage,
  // Types
  type SendMessageInput,
  type RetryMessageResponse,
  type MediaDownloadResponse,
  type ForwardMessageResponse,
  type InfiniteMessagesData,
} from "./messages";
