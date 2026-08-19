import * as React from "react";
import {
  getPrimaryModifier,
  type KeyboardShortcut,
  useKeyboardShortcuts,
} from "@/hooks/ui";
import { useTranslation } from "react-i18next";

/**
 * State for the keyboard shortcuts context
 */
export interface KeyboardShortcutsState {
  /** Whether shortcuts are globally enabled */
  enabled: boolean;
  /** Whether the help modal is open */
  isHelpModalOpen: boolean;
  /** Whether the search panel is open */
  isSearchPanelOpen: boolean;
  /** All registered shortcuts */
  shortcuts: KeyboardShortcut[];
}

/**
 * Context value for keyboard shortcuts
 */
export interface KeyboardShortcutsContextValue extends KeyboardShortcutsState {
  /** Enable keyboard shortcuts globally */
  enableShortcuts: () => void;
  /** Disable keyboard shortcuts globally (useful when typing in inputs) */
  disableShortcuts: () => void;
  /** Temporarily disable shortcuts and return a function to re-enable */
  suspendShortcuts: () => () => void;
  /** Open the keyboard shortcuts help modal */
  openHelpModal: () => void;
  /** Close the keyboard shortcuts help modal */
  closeHelpModal: () => void;
  /** Toggle the keyboard shortcuts help modal */
  toggleHelpModal: () => void;
  /** Open the search panel */
  openSearchPanel: () => void;
  /** Close the search panel */
  closeSearchPanel: () => void;
  /** Toggle the search panel */
  toggleSearchPanel: () => void;
  /** Focus the chat list search input (new chat) */
  focusNewChat: () => void;
  /** Navigate chat list up */
  navigateChatListUp: () => void;
  /** Navigate chat list down */
  navigateChatListDown: () => void;
  /** Close current modal/panel */
  closeCurrentModal: () => void;
  /** Register custom callbacks for actions */
  registerAction: (actionId: string, callback: () => void) => void;
  /** Unregister a custom callback */
  unregisterAction: (actionId: string) => void;
}

const KeyboardShortcutsContext = React.createContext<
  KeyboardShortcutsContextValue | undefined
>(undefined);

export interface KeyboardShortcutsProviderProps {
  children: React.ReactNode;
}

/**
 * Provider component for keyboard shortcuts
 * Wraps the app to enable global keyboard shortcuts
 */
export function KeyboardShortcutsProvider({
  children,
}: KeyboardShortcutsProviderProps) {
  const { t } = useTranslation();

  const [state, setState] = React.useState<KeyboardShortcutsState>({
    enabled: true,
    isHelpModalOpen: false,
    isSearchPanelOpen: false,
    shortcuts: [],
  });

  // Store for custom action callbacks
  const actionsRef = React.useRef<Map<string, () => void>>(new Map());

  // Action methods
  const enableShortcuts = React.useCallback(() => {
    setState((prev) => ({ ...prev, enabled: true }));
  }, []);

  const disableShortcuts = React.useCallback(() => {
    setState((prev) => ({ ...prev, enabled: false }));
  }, []);

  const suspendShortcuts = React.useCallback(() => {
    setState((prev) => ({ ...prev, enabled: false }));
    return () => {
      setState((prev) => ({ ...prev, enabled: true }));
    };
  }, []);

  const openHelpModal = React.useCallback(() => {
    setState((prev) => ({ ...prev, isHelpModalOpen: true }));
  }, []);

  const closeHelpModal = React.useCallback(() => {
    setState((prev) => ({ ...prev, isHelpModalOpen: false }));
  }, []);

  const toggleHelpModal = React.useCallback(() => {
    setState((prev) => ({ ...prev, isHelpModalOpen: !prev.isHelpModalOpen }));
  }, []);

  const openSearchPanel = React.useCallback(() => {
    setState((prev) => ({ ...prev, isSearchPanelOpen: true }));
    actionsRef.current.get("openSearchPanel")?.();
  }, []);

  const closeSearchPanel = React.useCallback(() => {
    setState((prev) => ({ ...prev, isSearchPanelOpen: false }));
    actionsRef.current.get("closeSearchPanel")?.();
  }, []);

  const toggleSearchPanel = React.useCallback(() => {
    setState((prev) => {
      const newState = !prev.isSearchPanelOpen;
      if (newState) {
        actionsRef.current.get("openSearchPanel")?.();
      } else {
        actionsRef.current.get("closeSearchPanel")?.();
      }
      return { ...prev, isSearchPanelOpen: newState };
    });
  }, []);

  const focusNewChat = React.useCallback(() => {
    // Try to find and focus the chat list search input
    const searchInput = document.querySelector<HTMLInputElement>(
      '[aria-label={t("chat.searchContactsAria", "Search contacts")}], [data-testid="chat-list-search"]',
    );
    if (searchInput) {
      searchInput.focus();
      searchInput.select();
    }
    actionsRef.current.get("focusNewChat")?.();
  }, []);

  const navigateChatListUp = React.useCallback(() => {
    actionsRef.current.get("navigateChatListUp")?.();
  }, []);

  const navigateChatListDown = React.useCallback(() => {
    actionsRef.current.get("navigateChatListDown")?.();
  }, []);

  const closeCurrentModal = React.useCallback(() => {
    // Close modals in order of priority
    if (state.isHelpModalOpen) {
      closeHelpModal();
      return;
    }
    if (state.isSearchPanelOpen) {
      closeSearchPanel();
      return;
    }
    // Let custom handlers handle other modals
    actionsRef.current.get("closeCurrentModal")?.();
  }, [
    state.isHelpModalOpen,
    state.isSearchPanelOpen,
    closeHelpModal,
    closeSearchPanel,
  ]);

  const registerAction = React.useCallback(
    (actionId: string, callback: () => void) => {
      actionsRef.current.set(actionId, callback);
    },
    [],
  );

  const unregisterAction = React.useCallback((actionId: string) => {
    actionsRef.current.delete(actionId);
  }, []);

  // Define all shortcuts
  const primaryMod = getPrimaryModifier();

  const shortcuts: KeyboardShortcut[] = React.useMemo(
    () => [
      // Navigation shortcuts
      {
        id: "new-chat",
        label: t("keyboard.shortcuts.newChat.label", "New Chat"),
        description: t(
          "keyboard.shortcuts.newChat.description",
          "Focus the search input to start a new chat",
        ),
        key: "n",
        modifiers: [primaryMod],
        category: "navigation",
        handler: focusNewChat,
      },
      {
        id: "open-search",
        label: t("keyboard.shortcuts.openSearch.label", "Open Search"),
        description: t(
          "keyboard.shortcuts.openSearch.description",
          "Open the global search panel",
        ),
        key: "f",
        modifiers: [primaryMod],
        category: "navigation",
        handler: toggleSearchPanel,
      },
      {
        id: "navigate-up",
        label: t("keyboard.shortcuts.navigateUp.label", "Navigate Up"),
        description: t(
          "keyboard.shortcuts.navigateUp.description",
          "Move up in the chat list",
        ),
        key: "ArrowUp",
        modifiers: [],
        category: "navigation",
        handler: navigateChatListUp,
        allowInInput: false,
      },
      {
        id: "navigate-down",
        label: t("keyboard.shortcuts.navigateDown.label", "Navigate Down"),
        description: t(
          "keyboard.shortcuts.navigateDown.description",
          "Move down in the chat list",
        ),
        key: "ArrowDown",
        modifiers: [],
        category: "navigation",
        handler: navigateChatListDown,
        allowInInput: false,
      },

      // General shortcuts
      {
        id: "show-shortcuts",
        label: t(
          "keyboard.shortcuts.showShortcuts.label",
          "Keyboard Shortcuts",
        ),
        description: t(
          "keyboard.shortcuts.showShortcuts.description",
          "Show this keyboard shortcuts help",
        ),
        key: "/",
        modifiers: [primaryMod],
        category: "general",
        handler: toggleHelpModal,
      },
      {
        id: "close-modal",
        label: t("keyboard.shortcuts.closeModal.label", "Close"),
        description: t(
          "keyboard.shortcuts.closeModal.description",
          "Close the current modal or panel",
        ),
        key: "Escape",
        modifiers: [],
        category: "general",
        handler: closeCurrentModal,
        allowInInput: true,
      },
    ],
    [
      t,
      primaryMod,
      focusNewChat,
      toggleSearchPanel,
      navigateChatListUp,
      navigateChatListDown,
      toggleHelpModal,
      closeCurrentModal,
    ],
  );

  // Update state with shortcuts
  React.useEffect(() => {
    setState((prev) => ({ ...prev, shortcuts }));
  }, [shortcuts]);

  // Register global shortcuts
  useKeyboardShortcuts({
    enabled: state.enabled,
    shortcuts,
  });

  const value = React.useMemo<KeyboardShortcutsContextValue>(
    () => ({
      ...state,
      enableShortcuts,
      disableShortcuts,
      suspendShortcuts,
      openHelpModal,
      closeHelpModal,
      toggleHelpModal,
      openSearchPanel,
      closeSearchPanel,
      toggleSearchPanel,
      focusNewChat,
      navigateChatListUp,
      navigateChatListDown,
      closeCurrentModal,
      registerAction,
      unregisterAction,
    }),
    [
      state,
      enableShortcuts,
      disableShortcuts,
      suspendShortcuts,
      openHelpModal,
      closeHelpModal,
      toggleHelpModal,
      openSearchPanel,
      closeSearchPanel,
      toggleSearchPanel,
      focusNewChat,
      navigateChatListUp,
      navigateChatListDown,
      closeCurrentModal,
      registerAction,
      unregisterAction,
    ],
  );

  return (
    <KeyboardShortcutsContext.Provider value={value}>
      {children}
    </KeyboardShortcutsContext.Provider>
  );
}

/**
 * Hook to access the keyboard shortcuts context
 */
export function useKeyboardShortcutsContext(): KeyboardShortcutsContextValue {
  const context = React.useContext(KeyboardShortcutsContext);
  if (context === undefined) {
    throw new Error(
      "useKeyboardShortcutsContext must be used within a KeyboardShortcutsProvider",
    );
  }
  return context;
}

/**
 * Hook to check if shortcuts are enabled
 */
export function useShortcutsEnabled(): boolean {
  const { enabled } = useKeyboardShortcutsContext();
  return enabled;
}

/**
 * Hook to get all registered shortcuts
 */
export function useRegisteredShortcuts(): KeyboardShortcut[] {
  const { shortcuts } = useKeyboardShortcutsContext();
  return shortcuts;
}

/**
 * Hook to register a custom action callback
 */
export function useRegisterShortcutAction(
  actionId: string,
  callback: () => void,
): void {
  const { registerAction, unregisterAction } = useKeyboardShortcutsContext();

  React.useEffect(() => {
    registerAction(actionId, callback);
    return () => {
      unregisterAction(actionId);
    };
  }, [actionId, callback, registerAction, unregisterAction]);
}

export default KeyboardShortcutsProvider;
