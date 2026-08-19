/**
 * Correlates user-initiated connection setup with the realtime "connected"
 * event so `whatsapp_connection_connected` fires only on a real transition
 * into connected — never because an already-connected item rendered and never
 * for background worker recoveries the user did not initiate.
 *
 * Expectations are bounded: each entry expires after a pairing-sized TTL and
 * the map is capped (oldest evicted), so abandoned flows can never leak or
 * mis-attribute a much later connect.
 */

export type ConnectionMode = "new" | "reconnect";

/** Generous upper bound for a QR pairing/reconnect flow the user abandoned. */
export const TRANSITION_TTL_MS = 10 * 60 * 1000;
/** Hard cap so the map stays bounded no matter how many flows are started. */
export const MAX_PENDING_TRANSITIONS = 16;

interface PendingTransition {
  mode: ConnectionMode;
  expiresAt: number;
}

const expectedTransitions = new Map<string, PendingTransition>();

/**
 * Called when a create (new) or reconnect request is issued. Re-registering
 * refreshes both the mode and the expiry.
 */
export function expectConnectionTransition(
  connectionId: string,
  mode: ConnectionMode,
  now: number = Date.now(),
): void {
  // Delete-then-set keeps Map insertion order equal to recency, so the cap
  // below always evicts the stalest expectation first.
  expectedTransitions.delete(connectionId);
  expectedTransitions.set(connectionId, {
    mode,
    expiresAt: now + TRANSITION_TTL_MS,
  });
  while (expectedTransitions.size > MAX_PENDING_TRANSITIONS) {
    const oldest = expectedTransitions.keys().next().value;
    if (oldest === undefined) break;
    expectedTransitions.delete(oldest);
  }
}

/**
 * Consumed once by the realtime "connected" handler. Returns null when the
 * transition was not user-initiated in this session, was already counted, or
 * the expectation expired — in all of which no event may be emitted.
 */
export function consumeConnectionTransition(
  connectionId: string,
  now: number = Date.now(),
): ConnectionMode | null {
  const pending = expectedTransitions.get(connectionId);
  expectedTransitions.delete(connectionId);
  if (!pending || pending.expiresAt <= now) return null;
  return pending.mode;
}

/**
 * Explicitly cancels an expectation when the flow demonstrably ended without
 * a user-attributable connect (failed reconnect, delete, disconnect, QR
 * expiry).
 */
export function clearConnectionTransition(connectionId: string): void {
  expectedTransitions.delete(connectionId);
}

/** Test hook. */
export function resetConnectionTransitions(): void {
  expectedTransitions.clear();
}
