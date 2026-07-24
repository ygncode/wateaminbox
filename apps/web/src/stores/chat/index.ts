/**
 * Chat Store - Modular Zustand store for chat state management
 *
 * This store is composed of multiple slices:
 * - conversation-slice: Selected conversation state
 * - typing-slice: Typing indicators
 * - drafts-slice: Draft messages and read status
 * - selection-slice: Message selection mode
 *
 * The store maintains backward compatibility with the original API.
 */

import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";

import { createConversationSlice } from "./conversation-slice";
import { createDraftsSlice } from "./drafts-slice";
import { createSelectionSlice } from "./selection-slice";
import type { ChatState } from "./types";
import { createTypingSlice } from "./typing-slice";

// Re-export types for backward compatibility
export type { ChatState, TypingIndicator } from "./types";

// Initial state for reset
const getInitialState = () => ({
  selectedConversationId: null,
  selectedConversation: null,
  selectedContact: null,
  typingIndicators: new Map(),
  lastReadMessageId: new Map(),
  draftMessages: new Map(),
  selectionMode: false,
  selectedMessageIds: new Set<string>(),
});

export const useChatStore = create<ChatState>()(
  devtools(
    persist(
      (...args) => ({
        ...createConversationSlice(...args),
        ...createTypingSlice(...args),
        ...createDraftsSlice(...args),
        ...createSelectionSlice(...args),

        reset: () =>
          args[0](
            {
              ...getInitialState(),
            },
            false,
            "reset",
          ),
      }),
      {
        name: "chat-store",
        // Only persist draft messages and read status
        partialize: (state) => ({
          draftMessages: state.draftMessages,
          lastReadMessageId: state.lastReadMessageId,
        }),
        // Custom storage to handle Map serialization
        storage: {
          getItem: (name) => {
            const str = localStorage.getItem(name);
            if (!str) return null;
            const parsed = JSON.parse(str);
            return {
              state: {
                ...parsed.state,
                draftMessages: new Map(parsed.state.draftMessages || []),
                lastReadMessageId: new Map(
                  parsed.state.lastReadMessageId || [],
                ),
              },
            };
          },
          setItem: (name, value) => {
            const state = value.state as Partial<ChatState>;
            const serializable = {
              state: {
                draftMessages: Array.from(state.draftMessages?.entries() ?? []),
                lastReadMessageId: Array.from(
                  state.lastReadMessageId?.entries() ?? [],
                ),
              },
            };
            localStorage.setItem(name, JSON.stringify(serializable));
          },
          removeItem: (name) => localStorage.removeItem(name),
        },
      },
    ),
    { name: "chat-store" },
  ),
);

// Selectors - maintained for backward compatibility
export const selectSelectedConversation = (state: ChatState) =>
  state.selectedConversation;
export const selectSelectedContact = (state: ChatState) =>
  state.selectedContact;

export const selectTypingIndicators =
  (conversationId: string) => (state: ChatState) =>
    state.typingIndicators.get(conversationId) ?? [];

export const selectDraftMessage =
  (conversationId: string) => (state: ChatState) =>
    state.draftMessages.get(conversationId) ?? "";

export const selectLastReadMessageId =
  (conversationId: string) => (state: ChatState) =>
    state.lastReadMessageId.get(conversationId);

// Selection mode selectors
export const selectSelectionMode = (state: ChatState) => state.selectionMode;
export const selectSelectedMessageIds = (state: ChatState) =>
  state.selectedMessageIds;
export const selectSelectedMessageCount = (state: ChatState) =>
  state.selectedMessageIds.size;
export const selectIsMessageSelected =
  (messageId: string) => (state: ChatState) =>
    state.selectedMessageIds.has(messageId);
