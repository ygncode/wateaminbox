/**
 * The surface messages sit on.
 *
 * The fill and the texture both come from the active theme: `--chat` paints
 * the canvas and `--chat-pattern` / `--chat-pattern-opacity` drive a masked
 * texture layer, so a theme opts into WhatsApp's doodle (or none) without any
 * component knowing which theme is active. Driving it from CSS also means the
 * empty state, the populated thread and the skeleton paint the identical
 * canvas and never re-render on a theme change.
 */
const PATTERN_MASK = `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/svg%3E")`;

/** Base fill for the canvas itself, kept next to the texture it carries. */
export const CONVERSATION_CANVAS_CLASS = "bg-chat";

export function ConversationCanvasPattern() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundColor: "var(--chat-pattern)",
        opacity: "var(--chat-pattern-opacity)",
        maskImage: PATTERN_MASK,
        WebkitMaskImage: PATTERN_MASK,
      }}
    />
  );
}
