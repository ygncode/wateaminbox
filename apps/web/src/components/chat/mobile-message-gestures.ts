export interface TouchTap {
  at: number;
  x: number;
  y: number;
}

const DOUBLE_TAP_WINDOW_MS = 350;
const DOUBLE_TAP_DISTANCE_PX = 24;

/** A deliberate second tap, without treating a scroll or swipe as a reaction. */
export function isDoubleTouchTap(
  previous: TouchTap,
  current: TouchTap,
): boolean {
  const elapsed = current.at - previous.at;
  if (elapsed <= 0 || elapsed > DOUBLE_TAP_WINDOW_MS) return false;

  return (
    Math.hypot(current.x - previous.x, current.y - previous.y) <=
    DOUBLE_TAP_DISTANCE_PX
  );
}

/** Interactive message content keeps its own double-tap/click behavior. */
export function isInteractiveMessageTarget(
  target: EventTarget | null,
): boolean {
  return (
    target instanceof Element &&
    Boolean(target.closest("a, button, input, textarea, select, audio, video"))
  );
}

export function isMobileReactionSurface(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.innerWidth < 768 || window.matchMedia("(pointer: coarse)").matches
  );
}
