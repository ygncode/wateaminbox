import type { StateCreator } from "zustand";
import type { ChatState, ConversationSlice } from "./types";

export const createConversationSlice: StateCreator<
  ChatState,
  [["zustand/devtools", never], ["zustand/persist", unknown]],
  [],
  ConversationSlice
> = (set) => ({
  selectedConversationId: null,
  selectedConversation: null,
  selectedContact: null,

  selectConversation: (conversationId, conversation, contact) =>
    set(
      {
        selectedConversationId: conversationId,
        selectedConversation: conversation ?? null,
        selectedContact: contact ?? null,
      },
      false,
      "selectConversation",
    ),
});
