import { beforeEach, describe, expect, test } from "bun:test";
import type { TypingEvent } from "../../lib/nats/index.js";
import {
  getEphemeralThrottleStats,
  resetEphemeralThrottle,
} from "../ephemeral-signal-throttle.js";
import { handleTypingEvent } from "./contact-handlers.js";

/**
 * Typing events arrive as JSON off NATS, so their declared `string` fields are
 * a contract with the worker rather than a runtime guarantee.
 *
 * The fan-out used to absorb a conversation-less event with its own
 * `if (!jid) return`. The ephemeral-signal throttle now runs first and keys on
 * that JID, and this handler rethrows - which in the consumer means the
 * message is redelivered. A payload that names no conversation therefore has
 * to be dropped before the throttle, not turned into a poison message.
 *
 * These need no database: a dropped event returns before any query, and the
 * throttle counter is what proves it stopped at the guard rather than further
 * downstream.
 */
function typingEvent(payload: Partial<TypingEvent["payload"]>): TypingEvent {
  return {
    contractVersion: 1,
    type: "typing",
    companyId: crypto.randomUUID(),
    connectionId: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    payload: { from: "", chatJid: "", isTyping: true, ...payload },
  } as TypingEvent;
}

describe("typing events that name no conversation", () => {
  beforeEach(() => {
    resetEphemeralThrottle();
  });

  test("absent chatJid and from is dropped instead of throwing", async () => {
    // Without the guard this throws inside the throttle's key builder.
    await expect(
      handleTypingEvent(
        typingEvent({
          from: undefined as unknown as string,
          chatJid: undefined as unknown as string,
        }),
      ),
    ).resolves.toBeUndefined();
    expect(getEphemeralThrottleStats().allowed).toBe(0);
  });

  test("blank chatJid and from is dropped before the throttle", async () => {
    await expect(
      handleTypingEvent(typingEvent({ from: "", chatJid: "" })),
    ).resolves.toBeUndefined();
    // An empty key would not throw, but it would occupy a throttle bucket that
    // every conversation-less event across every tenant shares.
    expect(getEphemeralThrottleStats().allowed).toBe(0);
    expect(getEphemeralThrottleStats().tracked).toBe(0);
  });
});
