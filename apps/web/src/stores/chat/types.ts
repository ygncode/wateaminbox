import type { Message, MessageStatus } from "@whatsapp-web/shared";
import type { Contact, Conversation } from "../../lib/api";

// Typing indicator type
export interface TypingIndicator {
  conversationId: string;
  userId: string;
  userName: string;
  startedAt: Date;
}

// Optimistic message for pending sends
export interface OptimisticMessage extends Message {
  isOptimistic: true;
  tempId: string;
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

export interface MessagesSlice {
  messagesCache: Map<string, Message[]>;
  optimisticMessages: Map<string, OptimisticMessage>;
  setMessages: (conversationId: string, messages: Message[]) => void;
  addMessage: (conversationId: string, message: Message) => void;
  updateMessage: (
    conversationId: string,
    messageId: string,
    updates: Partial<Message>,
  ) => void;
  updateMessageStatus: (
    conversationId: string,
    messageId: string,
    status: MessageStatus,
  ) => void;
  updateMessageReaction: (
    conversationId: string,
    messageId: string,
    reactorJid: string,
    emoji: string,
  ) => void;
  removeMessage: (conversationId: string, messageId: string) => void;
  prependMessages: (conversationId: string, messages: Message[]) => void;
  addOptimisticMessage: (message: OptimisticMessage) => void;
  confirmOptimisticMessage: (tempId: string, confirmedMessage: Message) => void;
  failOptimisticMessage: (tempId: string) => void;
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
  MessagesSlice &
  DraftsSlice &
  SelectionSlice & {
    reset: () => void;
  };
