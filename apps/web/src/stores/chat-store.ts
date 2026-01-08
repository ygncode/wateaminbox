/**
 * Chat Store - Re-exports for backward compatibility
 *
 * This file maintains backward compatibility with existing imports.
 * The actual implementation is now in the modular chat/ directory.
 *
 * @see ./chat/index.ts for the main store implementation
 * @see ./chat/types.ts for type definitions
 * @see ./chat/messages-slice.ts for message handling
 * @see ./chat/drafts-slice.ts for draft message handling
 * @see ./chat/selection-slice.ts for message selection
 * @see ./chat/typing-slice.ts for typing indicators
 * @see ./chat/conversation-slice.ts for conversation selection
 */

export {
  // Store hook
  useChatStore,
  // Types
  type ChatState,
  type OptimisticMessage,
  type TypingIndicator,
  // Selectors
  selectSelectedConversation,
  selectSelectedContact,
  selectTypingIndicators,
  selectMessages,
  selectDraftMessage,
  selectLastReadMessageId,
  selectHasOptimisticMessages,
  selectSelectionMode,
  selectSelectedMessageIds,
  selectSelectedMessageCount,
  selectIsMessageSelected,
  // Helper
  generateTempId,
} from "./chat";
