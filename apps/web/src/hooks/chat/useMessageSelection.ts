import { useCallback, useEffect } from "react";
import {
  selectSelectedMessageCount,
  selectSelectedMessageIds,
  selectSelectionMode,
  useChatStore,
} from "../../stores/chat-store";

interface UseMessageSelectionReturn {
  selectionMode: boolean;
  selectedMessageIds: Set<string>;
  selectedCount: number;
  enterSelectionMode: () => void;
  exitSelectionMode: () => void;
  toggleMessageSelection: (messageId: string) => void;
  handleMessageClick: (messageId: string) => void;
}

export function useMessageSelection(
  conversationId: string | undefined,
): UseMessageSelectionReturn {
  // Selection mode state from store
  const selectionMode = useChatStore(selectSelectionMode);
  const selectedMessageIds = useChatStore(selectSelectedMessageIds);
  const selectedCount = useChatStore(selectSelectedMessageCount);
  const enterSelectionMode = useChatStore((state) => state.enterSelectionMode);
  const exitSelectionMode = useChatStore((state) => state.exitSelectionMode);
  const toggleMessageSelection = useChatStore(
    (state) => state.toggleMessageSelection,
  );

  // Handle message click in selection mode
  const handleMessageClick = useCallback(
    (messageId: string) => {
      if (selectionMode) {
        toggleMessageSelection(messageId);
      }
    },
    [selectionMode, toggleMessageSelection],
  );

  // ESC key to exit selection mode
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && selectionMode) {
        exitSelectionMode();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectionMode, exitSelectionMode]);

  // Exit selection mode when conversation changes
  useEffect(() => {
    if (selectionMode) {
      exitSelectionMode();
    }
  }, [conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    selectionMode,
    selectedMessageIds,
    selectedCount,
    enterSelectionMode,
    exitSelectionMode,
    toggleMessageSelection,
    handleMessageClick,
  };
}
