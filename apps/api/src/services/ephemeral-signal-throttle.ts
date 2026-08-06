/**
 * Suppress repeats of ephemeral realtime signals.
 *
 * Typing and presence arrive from WhatsApp far faster than they carry new
 * information: a contact typing a sentence produces a stream of `typing:start`
 * events that all say the same thing. Each one now costs an assignment lookup
 * plus a Centrifugo publish, so repeats are worth collapsing.
 *
 * The rule is deliberately narrow: only an IDENTICAL state for the same
 * conversation within the interval is dropped. A STATE CHANGE always passes.
 * That is what keeps this safe - a `typing:stop` is never suppressed by a
 * preceding `typing:start`, so an indicator can never get stuck on because of
 * throttling. The same holds for presence going online -> offline.
 *
 * State is per process and purely an optimization: losing it (restart, second
 * replica) only means one extra event is delivered, never a missing one.
 */

import { env } from "../lib/env.js";

interface LastSignal {
  state: string;
  at: number;
}

const lastSignals = new Map<string, LastSignal>();

/**
 * Bounded so a workspace with many conversations cannot grow this forever.
 *
 * Eviction order is least-recently-*published*, not least-recently-seen: a
 * suppressed repeat deliberately does not refresh the entry's position. That
 * keeps the throttle window anchored to the last thing actually sent, so a
 * fast stream of repeats cannot extend its own suppression indefinitely.
 *
 * A constant rather than configuration, for the same reason as
 * `MAX_CACHED_COMPANIES`: it is a memory backstop with no operator-visible
 * effect until it engages, whereas the throttle INTERVAL genuinely affects
 * behaviour and is configurable (`REALTIME_EPHEMERAL_MIN_INTERVAL_MS`).
 */
export const MAX_TRACKED_SIGNAL_KEYS = 10_000;

let suppressed = 0;
let allowed = 0;

export function getEphemeralThrottleStats(): {
  suppressed: number;
  allowed: number;
  tracked: number;
} {
  return { suppressed, allowed, tracked: lastSignals.size };
}

/** Identifies the subject of an ephemeral signal. */
export interface EphemeralSignalSubject {
  /** Signal family - `typing` and `presence` never throttle each other. */
  kind: "typing" | "presence";
  companyId: string;
  connectionId: string;
  /** The conversation the signal is about (a JID). */
  conversationJid: string;
  /** Who the signal is about, when that differs from the conversation. */
  actorJid?: string;
}

/**
 * Build the throttle key for a subject.
 *
 * Centralized so the key's shape is defined once. Two call sites inventing
 * their own formats is how one of them ends up accidentally sharing a bucket
 * with another signal - or failing to.
 */
export function ephemeralSignalKey(subject: EphemeralSignalSubject): string {
  // Length-prefixed rather than delimiter-joined: a plain separator lets one
  // field's contents impersonate the next, so two different subjects could
  // share a bucket. Today's fields are UUIDs and JIDs so that is unreachable,
  // but the key stays injective for whatever gets added later.
  return [
    subject.kind,
    subject.companyId,
    subject.connectionId,
    subject.conversationJid,
    subject.actorJid ?? "",
  ]
    .map((part) => `${part.length}:${part}`)
    .join("");
}

/**
 * Whether this signal should be published.
 *
 * @param subject - what the signal is about
 * @param state - the signal's value; a change always publishes
 */
export function shouldPublishEphemeralSignal(
  subject: EphemeralSignalSubject,
  state: string,
  now: number = Date.now(),
): boolean {
  const key = ephemeralSignalKey(subject);
  const interval = env.REALTIME_EPHEMERAL_MIN_INTERVAL_MS;
  if (interval <= 0) {
    allowed++;
    return true;
  }

  const previous = lastSignals.get(key);

  // A different state is always news - never suppressed, at any rate.
  if (previous && previous.state === state && now - previous.at < interval) {
    suppressed++;
    return false;
  }

  // Re-insert so the Map's insertion order acts as the eviction order.
  lastSignals.delete(key);
  lastSignals.set(key, { state, at: now });
  while (lastSignals.size > MAX_TRACKED_SIGNAL_KEYS) {
    const oldest = lastSignals.keys().next().value;
    if (oldest === undefined) break;
    lastSignals.delete(oldest);
  }

  allowed++;
  return true;
}

/** Test seam. */
export function resetEphemeralThrottle(): void {
  lastSignals.clear();
  suppressed = 0;
  allowed = 0;
}
