/**
 * Consecutive-message grouping for the conversation thread.
 *
 * A run of messages from the same author, close together in time and not
 * split by a date separator, is drawn as one visual block: tight 2px gaps,
 * one tail on the first bubble, one avatar and one sender label per run. That
 * is what turns a wall of identically-spaced bubbles into something readable
 * on a phone, and it is the single biggest difference between the old thread
 * and the refreshed one.
 *
 * Kept free of React so the grouping rules - which decide when team
 * attribution and group-participant identity are allowed to be omitted - stay
 * unit-testable. Getting that wrong is not cosmetic: collapsing two different
 * teammates into one run would hide who actually replied.
 */

/** Default run window. Longer than a typing pause, shorter than a new turn. */
export const MESSAGE_GROUP_WINDOW_MS = 5 * 60 * 1000;

/**
 * The identity fields grouping is allowed to look at. Anything that changes
 * the name, avatar or side of a bubble has to be part of this shape, or two
 * visually different authors could be merged into one run.
 */
export interface GroupableMessage {
  /** "user" = sent from the team inbox / linked phone, else the contact. */
  senderType?: string | null;
  /** Teammate who pressed send, when the message left the shared inbox. */
  sentByUserId?: string | null;
  /** WhatsApp participant identity, used for group conversations. */
  senderJid?: string | null;
  senderId?: string | null;
  createdAt: string | Date;
}

export type BubbleGroupPosition = "single" | "first" | "middle" | "last";

/**
 * Identity key for a run. Outbound messages are keyed by the teammate (or the
 * linked phone) so two teammates replying back to back stay visually separate
 * and keep their own attribution label; inbound messages are keyed by the
 * WhatsApp participant so a group conversation never merges two people.
 */
export function getMessageAuthorKey(message: GroupableMessage): string {
  if (message.senderType === "user") {
    return `user:${message.sentByUserId ?? "linked-phone"}`;
  }
  return `contact:${message.senderJid ?? message.senderId ?? "unknown"}`;
}

function toTime(value: string | Date): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/**
 * Whether `next` continues the run started by `previous`. Unparseable or
 * out-of-order timestamps break the run rather than guess - a wrong merge
 * silently drops a sender label, while a wrong split only costs a gap.
 */
export function continuesMessageGroup(
  previous: GroupableMessage | null | undefined,
  next: GroupableMessage,
  windowMs: number = MESSAGE_GROUP_WINDOW_MS,
): boolean {
  if (!previous) return false;
  if (getMessageAuthorKey(previous) !== getMessageAuthorKey(next)) return false;

  const previousTime = toTime(previous.createdAt);
  const nextTime = toTime(next.createdAt);
  if (!Number.isFinite(previousTime) || !Number.isFinite(nextTime))
    return false;

  const gap = nextTime - previousTime;
  return gap >= 0 && gap <= windowMs;
}

export function resolveBubbleGroupPosition(
  continuesPrevious: boolean,
  continuedByNext: boolean,
): BubbleGroupPosition {
  if (continuesPrevious && continuedByNext) return "middle";
  if (continuesPrevious) return "last";
  if (continuedByNext) return "first";
  return "single";
}

/** The run's first bubble carries the tail and the sender's name. */
export function startsGroup(position: BubbleGroupPosition): boolean {
  return position === "first" || position === "single";
}

/** The run's last bubble carries the avatar, which is bottom-aligned. */
export function endsGroup(position: BubbleGroupPosition): boolean {
  return position === "last" || position === "single";
}

/**
 * Positions for a flat, chronologically ordered run of messages. A `null`
 * entry marks a non-message row (a date separator), which always breaks the
 * run - a bubble cannot continue a group across a day boundary.
 */
export function resolveBubbleGroupPositions(
  rows: readonly (GroupableMessage | null)[],
  windowMs: number = MESSAGE_GROUP_WINDOW_MS,
): (BubbleGroupPosition | null)[] {
  return rows.map((message, index) => {
    if (!message) return null;
    const previous = index > 0 ? rows[index - 1] : null;
    const next = index + 1 < rows.length ? rows[index + 1] : null;
    return resolveBubbleGroupPosition(
      continuesMessageGroup(previous, message, windowMs),
      next ? continuesMessageGroup(message, next, windowMs) : false,
    );
  });
}
