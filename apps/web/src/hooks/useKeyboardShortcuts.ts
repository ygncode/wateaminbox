import { useCallback, useEffect, useRef } from "react";

/**
 * Modifier keys for keyboard shortcuts
 */
export type ModifierKey = "ctrl" | "meta" | "alt" | "shift";

/**
 * Keyboard shortcut definition
 */
export interface KeyboardShortcut {
  /** Unique identifier for the shortcut */
  id: string;
  /** Display label for the shortcut */
  label: string;
  /** Description of what the shortcut does */
  description: string;
  /** Key to press (e.g., "n", "f", "/", "Escape", "ArrowUp") */
  key: string;
  /** Modifier keys required */
  modifiers?: ModifierKey[];
  /** Category for grouping in help modal */
  category: "navigation" | "chat" | "general";
  /** Callback when shortcut is triggered */
  handler: () => void;
  /** Whether this shortcut should work when input is focused */
  allowInInput?: boolean;
  /** Whether shortcut is currently enabled */
  enabled?: boolean;
}

/**
 * Platform detection utilities
 */
export function isMac(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /Mac|iPod|iPhone|iPad/.test(navigator.platform)
  );
}

/**
 * Get the primary modifier key for the current platform
 * Mac uses Cmd (meta), Windows/Linux uses Ctrl
 */
export function getPrimaryModifier(): ModifierKey {
  return isMac() ? "meta" : "ctrl";
}

/**
 * Get display text for a modifier key based on platform
 */
export function getModifierSymbol(modifier: ModifierKey): string {
  if (isMac()) {
    switch (modifier) {
      case "meta":
        return "\u2318"; // Cmd symbol
      case "ctrl":
        return "\u2303"; // Control symbol
      case "alt":
        return "\u2325"; // Option symbol
      case "shift":
        return "\u21E7"; // Shift symbol
      default:
        return modifier;
    }
  }
  // Windows/Linux
  switch (modifier) {
    case "meta":
      return "Win";
    case "ctrl":
      return "Ctrl";
    case "alt":
      return "Alt";
    case "shift":
      return "Shift";
    default:
      return modifier;
  }
}

/**
 * Get display text for a key
 */
export function getKeyDisplay(key: string): string {
  const keyMap: Record<string, string> = {
    ArrowUp: "\u2191",
    ArrowDown: "\u2193",
    ArrowLeft: "\u2190",
    ArrowRight: "\u2192",
    Escape: "Esc",
    Enter: "\u23CE",
    Backspace: "\u232B",
    Delete: "Del",
    Tab: "\u21E5",
    " ": "Space",
    "/": "/",
  };
  return keyMap[key] || key.toUpperCase();
}

/**
 * Format a shortcut for display
 */
export function formatShortcut(shortcut: KeyboardShortcut): string {
  const modifierSymbols =
    shortcut.modifiers?.map((m) => {
      // Replace platform-neutral modifiers with actual platform modifier
      if (m === "ctrl" && !isMac()) return getModifierSymbol("ctrl");
      if (m === "meta" && isMac()) return getModifierSymbol("meta");
      return getModifierSymbol(m);
    }) || [];

  return [...modifierSymbols, getKeyDisplay(shortcut.key)].join(
    isMac() ? "" : "+",
  );
}

/**
 * Check if a keyboard event matches a shortcut
 */
function matchesShortcut(
  event: KeyboardEvent,
  shortcut: KeyboardShortcut,
): boolean {
  // Check key match (case-insensitive for letters)
  // Guard against undefined keys
  if (!event.key || !shortcut.key) {
    return false;
  }
  const eventKey = event.key.toLowerCase();
  const shortcutKey = shortcut.key.toLowerCase();

  if (eventKey !== shortcutKey) {
    return false;
  }

  // Check modifiers
  const requiredModifiers = shortcut.modifiers || [];

  // Handle platform-aware modifiers (ctrl on Windows/Linux, meta on Mac)
  const needsCtrl =
    requiredModifiers.includes("ctrl") ||
    (requiredModifiers.includes("meta") && !isMac()) ||
    (getPrimaryModifier() === "ctrl" &&
      requiredModifiers.some((m) => m === "ctrl" || m === "meta"));
  const needsMeta =
    requiredModifiers.includes("meta") ||
    (getPrimaryModifier() === "meta" &&
      requiredModifiers.some((m) => m === "ctrl" || m === "meta"));
  const needsAlt = requiredModifiers.includes("alt");
  const needsShift = requiredModifiers.includes("shift");

  // On Mac, we check metaKey for Cmd
  // On Windows/Linux, we check ctrlKey for Ctrl
  const ctrlOrMetaMatches = isMac()
    ? event.metaKey === needsMeta
    : event.ctrlKey === needsCtrl;

  // Also verify the opposite modifier isn't pressed when not needed
  const oppositeModifierNotPressed = isMac()
    ? !event.ctrlKey || requiredModifiers.includes("ctrl")
    : !event.metaKey || requiredModifiers.includes("meta");

  return (
    ctrlOrMetaMatches &&
    oppositeModifierNotPressed &&
    event.altKey === needsAlt &&
    event.shiftKey === needsShift
  );
}

/**
 * Check if the event target is an input element
 */
function isInputElement(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  const isEditable = target.isContentEditable;

  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    isEditable
  );
}

/**
 * Options for the useKeyboardShortcuts hook
 */
export interface UseKeyboardShortcutsOptions {
  /** Whether shortcuts are enabled globally */
  enabled?: boolean;
  /** Shortcuts to register */
  shortcuts: KeyboardShortcut[];
}

/**
 * Hook for registering and handling keyboard shortcuts
 *
 * @example
 * ```tsx
 * useKeyboardShortcuts({
 *   shortcuts: [
 *     {
 *       id: "new-chat",
 *       label: "New Chat",
 *       description: "Focus the search input to start a new chat",
 *       key: "n",
 *       modifiers: [getPrimaryModifier()],
 *       category: "navigation",
 *       handler: () => focusSearchInput(),
 *     },
 *   ],
 * });
 * ```
 */
export function useKeyboardShortcuts({
  enabled = true,
  shortcuts,
}: UseKeyboardShortcutsOptions): void {
  // Use refs to avoid re-registering event listeners when shortcuts change
  const shortcutsRef = useRef(shortcuts);
  const enabledRef = useRef(enabled);

  // Update refs when values change
  useEffect(() => {
    shortcutsRef.current = shortcuts;
  }, [shortcuts]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // Skip if globally disabled
    if (!enabledRef.current) {
      return;
    }

    // Check if we're in an input field
    const inInput = isInputElement(event.target);

    // Find matching shortcut
    for (const shortcut of shortcutsRef.current) {
      // Skip disabled shortcuts
      if (shortcut.enabled === false) {
        continue;
      }

      // Skip shortcuts that don't work in inputs (unless explicitly allowed)
      if (inInput && !shortcut.allowInInput) {
        continue;
      }

      if (matchesShortcut(event, shortcut)) {
        event.preventDefault();
        event.stopPropagation();
        shortcut.handler();
        return;
      }
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);
}

/**
 * Hook for a single keyboard shortcut
 * Simpler API when you only need one shortcut
 */
export function useKeyboardShortcut(
  key: string,
  handler: () => void,
  options: {
    modifiers?: ModifierKey[];
    enabled?: boolean;
    allowInInput?: boolean;
  } = {},
): void {
  const { modifiers, enabled = true, allowInInput = false } = options;

  useKeyboardShortcuts({
    enabled,
    shortcuts: [
      {
        id: `single-${key}-${modifiers?.join("-") || "none"}`,
        label: "",
        description: "",
        key,
        modifiers,
        category: "general",
        handler,
        allowInInput,
      },
    ],
  });
}

export default useKeyboardShortcuts;
