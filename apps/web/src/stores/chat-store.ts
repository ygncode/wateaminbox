/**
 * Chat Store - Re-exports for backward compatibility
 *
 * This file maintains backward compatibility with existing imports.
 * The actual implementation is now in the modular chat/ directory.
 *
 * @see ./chat/index.ts for the main store implementation
 * @see ./chat/types.ts for type definitions
 * @see ./chat/drafts-slice.ts for draft message handling
 * @see ./chat/selection-slice.ts for message selection
 * @see ./chat/typing-slice.ts for typing indicators
 * @see ./chat/conversation-slice.ts for conversation selection
 */

export {
  // Types
  type ChatState,
  selectDraftMessage,
  selectIsMessageSelected,
  selectLastReadMessageId,
  selectSelectedContact,
  // Selectors
  selectSelectedConversation,
  selectSelectedMessageCount,
  selectSelectedMessageIds,
  selectSelectionMode,
  selectTypingIndicators,
  type TypingIndicator,
  // Store hook
  useChatStore,
} from "./chat";
