import type { VirtualizerOptions } from "@tanstack/react-virtual";

/**
 * Bottom-anchoring options for the message-list virtualizer.
 *
 * Media rows render at a placeholder height: the <img>/<video> is lazily
 * loaded with `h-auto`, so the row only reaches its real height once the
 * asset decodes — after any scroll-to-bottom reconciliation has already
 * settled. With the default `anchorTo: "start"` that late growth extends the
 * list below the viewport, parking the thread short of the newest message:
 * the floating scroll-down button appears, and clicking it lands short again
 * as the next lazily loaded image decodes. Anchoring the list to its end
 * makes the virtualizer compensate row-size changes while the viewport sits
 * at the newest message, so the thread stays pinned to the bottom.
 */
export const MESSAGE_LIST_END_ANCHOR = {
  anchorTo: "end",
  // Virtual px from the end still treated as "at the bottom" when a row
  // resizes. Slightly above the library default (1) to absorb fractional
  // scroll offsets on zoomed/HiDPI displays.
  scrollEndThreshold: 4,
} as const satisfies Partial<VirtualizerOptions<HTMLDivElement, Element>>;
