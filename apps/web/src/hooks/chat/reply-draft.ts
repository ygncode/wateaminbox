import type { Message } from "@wateaminbox/shared";

/**
 * Whether a reply draft the agent already picked is still valid.
 *
 * A block can land at any moment (from this tab's contact profile, or from
 * another agent, via the contact query's realtime invalidation) - possibly
 * with a reply already selected. The composer unmounts immediately (see
 * ComposerLifecycleArea's "blocked" state), which HIDES the draft without
 * discarding it, so an unblock minutes later would silently restore a
 * reply target the agent picked in a completely different context. The
 * draft is dropped instead: re-picking a reply is one click, and a
 * surprise quote attached to the next message is not recoverable once
 * sent.
 *
 * Kept as a pure rule (rather than only an effect) so the render that
 * observes the block already reports no draft - the effect that clears the
 * underlying state runs afterward, and this closes that one-render window.
 */
export function isReplyDraftStillValid(params: {
  isContactBlocked: boolean;
}): boolean {
  return !params.isContactBlocked;
}

/** Applies `isReplyDraftStillValid` to the draft itself. */
export function resolveActiveReplyDraft(params: {
  replyToMessage: Message | null;
  isContactBlocked: boolean;
}): Message | null {
  return isReplyDraftStillValid(params) ? params.replyToMessage : null;
}
