/**
 * Decides where a message thread should be anchored when a conversation's
 * messages first become available.
 *
 * The decision is keyed by conversation id rather than by a "did the initial
 * scroll run" boolean. A boolean has to be cleared by a separate effect, and
 * effects run in declaration order within a single commit: when switching to a
 * conversation whose messages are already cached, the scroll effect saw a stale
 * `true` and skipped, and only afterwards did the reset effect clear the flag.
 * Nothing re-triggered the scroll, so the thread stayed parked on the previous
 * conversation's offset with the floating scroll-to-bottom button showing.
 */
export type NewestMessageAnchor =
  | "wait"
  | "already-anchored"
  | "highlighted-message"
  | "newest-message";

export interface NewestMessageAnchorInput {
  /** Conversation currently rendered by the thread. */
  conversationId: string | undefined;
  /** Conversation whose anchor already ran, or null when none has. */
  anchoredConversationId: string | null;
  /** Number of virtual rows currently available for the conversation. */
  itemCount: number;
  /** A highlighted message or reply navigation target owns the position. */
  hasHighlightTarget: boolean;
}

export function resolveNewestMessageAnchor({
  conversationId,
  anchoredConversationId,
  itemCount,
  hasHighlightTarget,
}: NewestMessageAnchorInput): NewestMessageAnchor {
  // Nothing to anchor to yet; the caller retries once messages arrive.
  if (!conversationId || itemCount === 0) return "wait";

  if (anchoredConversationId === conversationId) return "already-anchored";

  // Highlight/reply navigation scrolls to its own target, so claim the anchor
  // without moving the viewport.
  return hasHighlightTarget ? "highlighted-message" : "newest-message";
}
