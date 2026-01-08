import type { StateCreator } from "zustand";
import type { ChatState, TypingIndicator, TypingSlice } from "./types";

export const createTypingSlice: StateCreator<
  ChatState,
  [["zustand/devtools", never], ["zustand/persist", unknown]],
  [],
  TypingSlice
> = (set) => ({
  typingIndicators: new Map<string, TypingIndicator[]>(),

  addTypingIndicator: (indicator) =>
    set(
      (state) => {
        const newMap = new Map(state.typingIndicators);
        const existing = newMap.get(indicator.conversationId) ?? [];

        // Don't add duplicate
        if (existing.some((t) => t.userId === indicator.userId)) {
          return state;
        }

        newMap.set(indicator.conversationId, [...existing, indicator]);
        return { typingIndicators: newMap };
      },
      false,
      "addTypingIndicator",
    ),

  removeTypingIndicator: (conversationId, userId) =>
    set(
      (state) => {
        const newMap = new Map(state.typingIndicators);
        const existing = newMap.get(conversationId) ?? [];
        const filtered = existing.filter((t) => t.userId !== userId);

        if (filtered.length === 0) {
          newMap.delete(conversationId);
        } else {
          newMap.set(conversationId, filtered);
        }

        return { typingIndicators: newMap };
      },
      false,
      "removeTypingIndicator",
    ),

  clearTypingIndicators: (conversationId) =>
    set(
      (state) => {
        const newMap = new Map(state.typingIndicators);
        newMap.delete(conversationId);
        return { typingIndicators: newMap };
      },
      false,
      "clearTypingIndicators",
    ),
});
