/**
 * The surface messages sit on.
 *
 * Two stacked layers swapped by the `dark:` variant rather than one layer
 * recoloured from `useTheme()`: the pattern is decorative, so it has no
 * business making the thread re-render on a theme change, and driving it from
 * CSS means the empty state, the populated thread and any preview host all
 * paint the identical canvas instead of each rebuilding the data URL.
 */
const patternUrl = (fill: string, opacity: string) =>
  `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='${fill}' fill-opacity='${opacity}'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`;

/** Base fill for the canvas itself, kept next to the texture it carries. */
export const CONVERSATION_CANVAS_CLASS = "bg-[#e5ddd5] dark:bg-dark-primary";

export function ConversationCanvasPattern() {
  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.055] dark:hidden"
        style={{ backgroundImage: patternUrl("%23000000", "1") }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 hidden opacity-90 dark:block"
        style={{ backgroundImage: patternUrl("%231a2730", "0.4") }}
      />
    </>
  );
}
