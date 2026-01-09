/**
 * @deprecated Import from '@/hooks/ui' instead: import { useKeyboardShortcuts } from '@/hooks/ui'
 * This file is kept for backward compatibility.
 */
export {
  useKeyboardShortcuts,
  useKeyboardShortcut,
  isMac,
  getPrimaryModifier,
  getModifierSymbol,
  getKeyDisplay,
  formatShortcut,
  type ModifierKey,
  type KeyboardShortcut,
  type UseKeyboardShortcutsOptions,
} from "./ui/useKeyboardShortcuts";

export { useKeyboardShortcuts as default } from "./ui/useKeyboardShortcuts";
