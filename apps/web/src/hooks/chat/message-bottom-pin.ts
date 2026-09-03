/**
 * Keeps the message thread at the true DOM bottom through the
 * estimates-to-measurements churn that follows the initial anchor.
 *
 * TanStack's `anchorTo: "end"` (message-list-end-anchor.ts) compensates row
 * growth by writing `scrollTop += delta`, but the browser clamps that write
 * against the scrollHeight of the moment — and with `useFlushSync: false`
 * React commits the grown inner box asynchronously, so the write can land
 * short by the height of the rows below the grown one. The clamped offset
 * feeds back through the scroll event, and once the virtual distance from
 * the end exceeds `scrollEndThreshold` the library stops compensating
 * altogether: the next media decode adds its full height to the deficit and
 * the thread parks above the newest message with the scroll-down button
 * showing. This is what a first refresh of a media-heavy chat looked like —
 * placeholder-height image rows (a 320×240 attribute box with `h-auto`)
 * decode into much taller portrait images after the anchor has settled.
 *
 * The pin owns the app-level intent "the viewport belongs at the newest
 * message". While pinned, every scroll event and every committed measurement
 * change re-checks the real DOM distance from the bottom, and the caller is
 * asked to reassert the bottom whenever content grew underneath the
 * viewport. An upward scroll releases the pin, so a reader in history is
 * never yanked down; reaching the bottom again (by hand or via the
 * scroll-down button) re-engages it.
 */

export interface BottomPinMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/** Distance (px) from the true DOM bottom still treated as pinned. */
export const BOTTOM_PIN_SLACK_PX = 4;

/**
 * Upward scrollTop movement (px) treated as the user leaving the bottom.
 * Above sub-pixel noise from zoomed/HiDPI displays.
 */
const SCROLL_UP_EPSILON_PX = 1;

export type BottomPinDecision = "repin" | "none";

export interface BottomPin {
  isPinned(): boolean;
  /** The thread anchored, auto-scrolled, or the scroll-down button ran. */
  intend(): void;
  /** A highlight/reply navigation target owns the viewport position. */
  release(): void;
  /** The conversation changed; forget the previous viewport entirely. */
  reset(): void;
  /**
   * Feed the current container metrics after a scroll event or a commit
   * that changed measured row sizes. Returns "repin" when the caller must
   * scroll the container back to its true bottom.
   */
  observe(metrics: BottomPinMetrics): BottomPinDecision;
}

export function createBottomPin(): BottomPin {
  let pinned = false;
  let prevScrollTop: number | null = null;

  return {
    isPinned: () => pinned,
    intend() {
      pinned = true;
    },
    release() {
      pinned = false;
    },
    reset() {
      pinned = false;
      prevScrollTop = null;
    },
    observe({ scrollTop, scrollHeight, clientHeight }) {
      const distance = scrollHeight - scrollTop - clientHeight;
      const scrolledUp =
        prevScrollTop !== null &&
        scrollTop < prevScrollTop - SCROLL_UP_EPSILON_PX;
      prevScrollTop = scrollTop;

      // At the bottom: (re)engage the pin. Also how a user who scrolls back
      // down by hand becomes pinned again. An unscrollable container (empty
      // or fully visible conversation) is trivially "at the bottom" and must
      // not seed a pin that would later fight highlight navigation.
      if (distance <= BOTTOM_PIN_SLACK_PX) {
        if (scrollHeight - clientHeight > BOTTOM_PIN_SLACK_PX) {
          pinned = true;
        }
        return "none";
      }

      // The viewport moved up. Content growth and the virtualizer's clamped
      // compensations only ever keep scrollTop or push it down, so an upward
      // move is the user (or a shrink correction, which the following commit
      // re-engages via the at-bottom branch above). Never yank them back.
      if (scrolledUp) {
        pinned = false;
        return "none";
      }

      return pinned ? "repin" : "none";
    },
  };
}
