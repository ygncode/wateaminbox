/**
 * Presentation classes for the notification sheet.
 *
 * The sheet is one surface with two responsive presentations:
 * - below `md` (< 768px, matching `useIsMobile`) it takes over the whole
 *   viewport like a page, so there is nothing to reach around on a phone
 * - from `md` upwards it is anchored flush to the right edge and spans the
 *   full viewport height, like a side sheet rather than a floating card
 *
 * Kept in a plain module so the responsive contract is assertable in tests.
 */

/** Scrim painted behind the sheet while it is open. */
export const NOTIFICATION_SCRIM_CLASS = [
  "fixed inset-0 z-40 animate-scrim-in",
  "bg-gray-950/40 md:bg-gray-950/25 dark:bg-black/60",
].join(" ");

/** Full-viewport page on mobile, right-anchored full-height sheet on md+. */
export const NOTIFICATION_SHEET_CLASS = [
  "fixed z-50 flex flex-col overflow-hidden outline-none",
  "bg-white dark:bg-dark-secondary animate-sheet-in-right",
  // Mobile: the sheet is the page.
  "inset-0 h-dvh w-full",
  // md+: flush against the right edge, full height, bounded width.
  "md:inset-y-0 md:left-auto md:right-0 md:h-dvh",
  "md:w-[400px] md:max-w-[calc(100vw-3rem)]",
  "md:border-l md:border-gray-200 md:shadow-2xl md:dark:border-dark-border",
].join(" ");

/** Fills the container it is portalled into instead of the viewport. */
export const NOTIFICATION_SHEET_EMBEDDED_CLASS = [
  "absolute inset-0 z-50 flex h-full w-full flex-col overflow-hidden outline-none",
  "border-0 bg-white dark:bg-dark-secondary",
].join(" ");

/**
 * Elements inside the sheet that can hold focus, used to keep Tab cycling
 * within the sheet while it is presented as a modal surface.
 */
export const SHEET_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");
