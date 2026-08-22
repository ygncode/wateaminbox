/**
 * On-screen keyboard inset for the conversation composer.
 *
 * Two browsers, two behaviours. Android Chrome resizes the *layout* viewport
 * when the keyboard opens (with `interactive-widget=resizes-content`), so the
 * shell's `h-dvh` already shrinks and the composer stays above the keyboard on
 * its own. iOS Safari does not: the layout viewport keeps its full height and
 * the keyboard simply covers the bottom of the page, hiding the composer that
 * was just fixed into view.
 *
 * The fix is to measure the overlap between the layout viewport and the
 * visual viewport and hand it to CSS as an inset the composer pads itself by.
 * The measurement is isolated here, without React or DOM access, because the
 * failure mode of getting it wrong is a large permanent gap under the
 * composer - exactly the class of bug this whole area keeps producing.
 */

export const KEYBOARD_INSET_CSS_VAR = "--wa-keyboard-inset";

/**
 * Overlaps smaller than this are never a keyboard. Sub-pixel rounding, a
 * collapsing URL bar and iOS's own bottom toolbar all produce a few dozen
 * pixels of difference with no keyboard on screen; the smallest real phone
 * keyboard is roughly 220px.
 */
export const KEYBOARD_MIN_OVERLAP_PX = 90;

/** A keyboard never covers more of the screen than this. */
const MAX_OVERLAP_RATIO = 0.7;

/** Pinch-zoom also shrinks the visual viewport, and must not count. */
const ZOOM_TOLERANCE = 0.05;

export interface ViewportMetrics {
  /** `window.innerHeight` - unchanged by the iOS keyboard. */
  layoutViewportHeight: number;
  /** `visualViewport.height` - shrinks when the keyboard covers the page. */
  visualViewportHeight: number;
  /** `visualViewport.offsetTop` - non-zero once the page scrolls under it. */
  visualViewportOffsetTop: number;
  /** `visualViewport.scale` - 1 unless the user pinch-zoomed. */
  visualViewportScale: number;
}

/**
 * Pixels of the layout viewport currently hidden behind the keyboard, or 0
 * when there is nothing to compensate for (Android, desktop, pinch zoom, or
 * an implausible measurement).
 */
export function resolveKeyboardInset(metrics: ViewportMetrics): number {
  const {
    layoutViewportHeight,
    visualViewportHeight,
    visualViewportOffsetTop,
    visualViewportScale,
  } = metrics;

  if (
    !Number.isFinite(layoutViewportHeight) ||
    !Number.isFinite(visualViewportHeight) ||
    !Number.isFinite(visualViewportOffsetTop) ||
    layoutViewportHeight <= 0
  ) {
    return 0;
  }

  // Zoomed in, the visual viewport is smaller for a reason that is not a
  // keyboard; padding the composer would fight the user's own zoom.
  if (
    !Number.isFinite(visualViewportScale) ||
    Math.abs(visualViewportScale - 1) > ZOOM_TOLERANCE
  ) {
    return 0;
  }

  const overlap =
    layoutViewportHeight - (visualViewportHeight + visualViewportOffsetTop);
  if (overlap < KEYBOARD_MIN_OVERLAP_PX) return 0;

  return Math.round(
    Math.min(overlap, layoutViewportHeight * MAX_OVERLAP_RATIO),
  );
}
