/**
 * UI-related hooks
 *
 * Hooks for common UI patterns: debouncing, media queries, gestures,
 * keyboard shortcuts, and form state management.
 */

// Debouncing
export { useDebounce } from "./useDebounce";

// Media queries and responsive design
export {
  useMediaQuery,
  useIsMobile,
  useIsTablet,
  useIsSmallMobile,
  useIsTouchDevice,
  useIsLandscape,
  useBreakpoints,
} from "./useMediaQuery";

// Swipe gesture detection
export {
  useSwipeGesture,
  useSwipeGestureCallback,
  useSwipeProgress,
  type SwipeDirection,
  type SwipeGestureOptions,
  type SwipeState,
} from "./useSwipeGesture";

// Keyboard shortcuts
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
} from "./useKeyboardShortcuts";

// Form state management
export { useFormState } from "./useFormState";

// Click outside detection
export {
  useClickOutside,
  type UseClickOutsideOptions,
} from "./useClickOutside";

// Textarea auto-resize
export {
  useTextareaAutoResize,
  type UseTextareaAutoResizeOptions,
} from "./useTextareaAutoResize";

// Element position calculation
export {
  useRelativePosition,
  usePopoverPosition,
  type Position,
  type PositionOptions,
  type PopoverPositionOptions,
} from "./useElementPosition";

// Viewport-bounded position (for floating elements)
export {
  useViewportBoundedPosition,
  useAutoAdjustedPosition,
  type ViewportBoundedPosition,
  type ViewportBoundedPositionOptions,
  type ViewportBoundedPositionResult,
  type UseAutoAdjustedPositionOptions,
  type Placement,
} from "./useViewportBoundedPosition";

// On-screen keyboard overlap (iOS Safari does not resize the layout viewport)
export { useKeyboardInset } from "./useKeyboardInset";
export {
  resolveKeyboardInset,
  KEYBOARD_INSET_CSS_VAR,
  KEYBOARD_MIN_OVERLAP_PX,
  type ViewportMetrics,
} from "./keyboard-inset";
