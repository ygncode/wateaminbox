/**
 * Rules for the composer's schedule affordance.
 *
 * Kept free of React so both the "is it offered at all" gate and the time
 * validation stay unit-testable - the second one in particular decides whether
 * a send happens at all, and its boundary is shared with the server.
 */

/** Mirror of the server-side minimum lead time, with UI slack on top. */
export const MIN_SCHEDULE_LEAD_MS = 60_000;

export interface ScheduleAffordanceInput {
  /** Raw composer text, untrimmed. */
  text: string;
  /** Composer is disabled (sending, or the account is disconnected). */
  isInputDisabled: boolean;
  /** A conversation is actually addressed. */
  hasContact: boolean;
}

/**
 * Whether scheduling is possible right now.
 *
 * The control is *hidden* rather than disabled when this is false. A disabled
 * icon sitting permanently in the composer reads as a broken button: on a
 * phone it is one of four targets in a 40px-tall field, it cannot show a
 * tooltip explaining itself, and it is greyed out in the state the composer
 * spends nearly all of its life in - empty. Nothing is lost by hiding it,
 * because the only way to make it usable is to type, which reveals it.
 *
 * Whitespace does not count: `trim()` also strips non-breaking spaces and
 * newlines, so a message of blank lines cannot open the picker and then be
 * rejected on submit.
 */
export function canScheduleMessage({
  text,
  isInputDisabled,
  hasContact,
}: ScheduleAffordanceInput): boolean {
  return text.trim().length > 0 && !isInputDisabled && hasContact;
}

export type ScheduleTimeResult =
  | { ok: true; iso: string }
  | { ok: false; reason: "invalid" | "too-soon" };

/**
 * Validates a `datetime-local` value against the lead time and converts it to
 * the UTC ISO string the API expects. `now` is injected so the boundary is
 * testable without freezing the clock.
 */
export function resolveScheduledAt(
  localValue: string,
  now: number = Date.now(),
): ScheduleTimeResult {
  const parsed = new Date(localValue);
  const time = parsed.getTime();
  if (Number.isNaN(time)) return { ok: false, reason: "invalid" };
  if (time - now < MIN_SCHEDULE_LEAD_MS)
    return { ok: false, reason: "too-soon" };
  return { ok: true, iso: parsed.toISOString() };
}
