import type { Contact, Conversation } from "../../lib/api";

// Typing indicator type
export interface TypingIndicator {
  conversationId: string;
  userId: string;
  userName: string;
  startedAt: Date;
}

// Slice state interfaces
export interface ConversationSlice {
  selectedConversationId: string | null;
  selectedConversation: Conversation | null;
  selectedContact: Contact | null;
  selectConversation: (
    conversationId: string | null,
    conversation?: Conversation,
    contact?: Contact,
  ) => void;
}

export interface TypingSlice {
  typingIndicators: Map<string, TypingIndicator[]>;
  addTypingIndicator: (indicator: TypingIndicator) => void;
  removeTypingIndicator: (conversationId: string, userId: string) => void;
  clearTypingIndicators: (conversationId: string) => void;
}

export interface DraftsSlice {
  draftMessages: Map<string, string>;
  lastReadMessageId: Map<string, string>;
  setDraftMessage: (conversationId: string, content: string) => void;
  clearDraftMessage: (conversationId: string) => void;
  setLastReadMessageId: (conversationId: string, messageId: string) => void;
}

export interface SelectionSlice {
  selectionMode: boolean;
  selectedMessageIds: Set<string>;
  enterSelectionMode: () => void;
  exitSelectionMode: () => void;
  toggleMessageSelection: (messageId: string) => void;
  selectAllMessages: (messageIds: string[]) => void;
  clearSelection: () => void;
}

// Combined state type
export type ChatState = ConversationSlice &
  TypingSlice &
  DraftsSlice &
  SelectionSlice & {
    reset: () => void;
  };
