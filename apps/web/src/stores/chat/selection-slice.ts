import type { StateCreator } from "zustand";
import type { ChatState, SelectionSlice } from "./types";

export const createSelectionSlice: StateCreator<
  ChatState,
  [["zustand/devtools", never], ["zustand/persist", unknown]],
  [],
  SelectionSlice
> = (set) => ({
  selectionMode: false,
  selectedMessageIds: new Set<string>(),

  enterSelectionMode: () =>
    set(
      { selectionMode: true, selectedMessageIds: new Set<string>() },
      false,
      "enterSelectionMode",
    ),

  exitSelectionMode: () =>
    set(
      { selectionMode: false, selectedMessageIds: new Set<string>() },
      false,
      "exitSelectionMode",
    ),

  toggleMessageSelection: (messageId) =>
    set(
      (state) => {
        const newSet = new Set(state.selectedMessageIds);
        if (newSet.has(messageId)) {
          newSet.delete(messageId);
        } else {
          newSet.add(messageId);
        }
        return { selectedMessageIds: newSet };
      },
      false,
      "toggleMessageSelection",
    ),

  selectAllMessages: (messageIds) =>
    set(
      { selectedMessageIds: new Set(messageIds) },
      false,
      "selectAllMessages",
    ),

  clearSelection: () =>
    set({ selectedMessageIds: new Set<string>() }, false, "clearSelection"),
});
