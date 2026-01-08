import type { StateCreator } from "zustand";
import type { ChatState, DraftsSlice } from "./types";

export const createDraftsSlice: StateCreator<
  ChatState,
  [["zustand/devtools", never], ["zustand/persist", unknown]],
  [],
  DraftsSlice
> = (set) => ({
  draftMessages: new Map<string, string>(),
  lastReadMessageId: new Map<string, string>(),

  setDraftMessage: (conversationId, content) =>
    set(
      (state) => {
        const newMap = new Map(state.draftMessages);
        if (content.trim()) {
          newMap.set(conversationId, content);
        } else {
          newMap.delete(conversationId);
        }
        return { draftMessages: newMap };
      },
      false,
      "setDraftMessage",
    ),

  clearDraftMessage: (conversationId) =>
    set(
      (state) => {
        const newMap = new Map(state.draftMessages);
        newMap.delete(conversationId);
        return { draftMessages: newMap };
      },
      false,
      "clearDraftMessage",
    ),

  setLastReadMessageId: (conversationId, messageId) =>
    set(
      (state) => {
        const newMap = new Map(state.lastReadMessageId);
        newMap.set(conversationId, messageId);
        return { lastReadMessageId: newMap };
      },
      false,
      "setLastReadMessageId",
    ),
});
