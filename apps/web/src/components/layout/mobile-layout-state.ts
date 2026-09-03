// Mobile chat navigation is URL-driven. Keeping this decision pure prevents
// the animated panels from drifting out of sync with browser back/forward
// gestures, which update the route before React effects run.
export type MobileView = "chat-list" | "message-thread" | "contact-info";

export function resolveMobileView(
  selectedChatId: string | null | undefined,
): MobileView {
  return selectedChatId ? "message-thread" : "chat-list";
}
