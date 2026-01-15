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
  // Selection mode state from store - subscribe to state values only
  const selectionMode = useChatStore(selectSelectionMode);
  const selectedMessageIds = useChatStore(selectSelectedMessageIds);
  const selectedCount = useChatStore(selectSelectedMessageCount);

  // Access actions via getState() to avoid unnecessary subscriptions
  const enterSelectionMode = useCallback(
    () => useChatStore.getState().enterSelectionMode(),
    [],
  );
  const exitSelectionMode = useCallback(
    () => useChatStore.getState().exitSelectionMode(),
    [],
  );
  const toggleMessageSelection = useCallback(
    (messageId: string) =>
      useChatStore.getState().toggleMessageSelection(messageId),
    [],
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
