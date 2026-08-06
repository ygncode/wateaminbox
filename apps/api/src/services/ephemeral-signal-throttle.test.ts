import { beforeEach, describe, expect, test } from "bun:test";
import {
  ephemeralSignalKey,
  getEphemeralThrottleStats,
  resetEphemeralThrottle,
  shouldPublishEphemeralSignal,
} from "./ephemeral-signal-throttle.js";

import type { EphemeralSignalSubject } from "./ephemeral-signal-throttle.js";

const KEY: EphemeralSignalSubject = {
  kind: "typing",
  companyId: "company-a",
  connectionId: "conn-1",
  conversationJid: "15551230000@s.whatsapp.net",
};
const OTHER_KEY: EphemeralSignalSubject = {
  ...KEY,
  conversationJid: "15559990000@s.whatsapp.net",
};

/**
 * Typing and presence arrive far faster than they carry new information. The
 * throttle collapses repeats, but a STATE CHANGE must always pass - otherwise
 * a suppressed `typing:stop` would leave an indicator stuck on forever.
 */
describe("ephemeral signal throttle", () => {
  beforeEach(() => {
    resetEphemeralThrottle();
  });

  test("the first signal always publishes", () => {
    expect(shouldPublishEphemeralSignal(KEY, "start", 1_000)).toBe(true);
  });

  test("an identical repeat inside the interval is suppressed", () => {
    expect(shouldPublishEphemeralSignal(KEY, "start", 1_000)).toBe(true);
    expect(shouldPublishEphemeralSignal(KEY, "start", 1_100)).toBe(false);
    expect(shouldPublishEphemeralSignal(KEY, "start", 1_400)).toBe(false);
    expect(getEphemeralThrottleStats().suppressed).toBe(2);
  });

  test("a state CHANGE is never suppressed, however soon it arrives", () => {
    // The safety property: a stop always gets through, so an indicator can
    // never be left stuck on by throttling.
    expect(shouldPublishEphemeralSignal(KEY, "start", 1_000)).toBe(true);
    expect(shouldPublishEphemeralSignal(KEY, "stop", 1_001)).toBe(true);
    expect(shouldPublishEphemeralSignal(KEY, "start", 1_002)).toBe(true);
    expect(shouldPublishEphemeralSignal(KEY, "stop", 1_003)).toBe(true);
    expect(getEphemeralThrottleStats().suppressed).toBe(0);
  });

  test("an identical signal publishes again once the interval lapses", () => {
    expect(shouldPublishEphemeralSignal(KEY, "start", 1_000)).toBe(true);
    expect(shouldPublishEphemeralSignal(KEY, "start", 1_500)).toBe(false);
    // Default interval is 1500ms.
    expect(shouldPublishEphemeralSignal(KEY, "start", 2_500)).toBe(true);
  });

  test("a suppressed repeat does not extend the window", () => {
    // Otherwise a fast enough stream could suppress indefinitely.
    expect(shouldPublishEphemeralSignal(KEY, "start", 0)).toBe(true);
    for (let t = 100; t < 1_500; t += 100) {
      expect(shouldPublishEphemeralSignal(KEY, "start", t)).toBe(false);
    }
    expect(shouldPublishEphemeralSignal(KEY, "start", 1_500)).toBe(true);
  });

  test("different conversations are throttled independently", () => {
    expect(shouldPublishEphemeralSignal(KEY, "start", 1_000)).toBe(true);
    expect(shouldPublishEphemeralSignal(OTHER_KEY, "start", 1_000)).toBe(true);
    expect(shouldPublishEphemeralSignal(KEY, "start", 1_100)).toBe(false);
    expect(shouldPublishEphemeralSignal(OTHER_KEY, "start", 1_100)).toBe(false);
  });

  test("presence transitions behave the same way", () => {
    const presenceKey: EphemeralSignalSubject = { ...KEY, kind: "presence" };
    expect(shouldPublishEphemeralSignal(presenceKey, "online", 0)).toBe(true);
    expect(shouldPublishEphemeralSignal(presenceKey, "online", 500)).toBe(
      false,
    );
    expect(shouldPublishEphemeralSignal(presenceKey, "offline", 501)).toBe(
      true,
    );
  });

  test("tracked keys stay bounded", () => {
    for (let i = 0; i < 12_000; i++) {
      shouldPublishEphemeralSignal(
        { ...KEY, conversationJid: `jid-${i}` },
        "start",
        i,
      );
    }
    expect(getEphemeralThrottleStats().tracked).toBeLessThanOrEqual(10_000);
  });
});

describe("throttle keys separate signal families", () => {
  test("typing and presence for one conversation never share a bucket", () => {
    // Same company/connection/JID, different family: suppressing one must not
    // suppress the other.
    const typing: EphemeralSignalSubject = { ...KEY, kind: "typing" };
    const presence: EphemeralSignalSubject = { ...KEY, kind: "presence" };
    expect(shouldPublishEphemeralSignal(typing, "start", 0)).toBe(true);
    expect(shouldPublishEphemeralSignal(presence, "start", 0)).toBe(true);
  });

  test("different actors in one group conversation are tracked apart", () => {
    // Two people typing in the same group must both be announced.
    const a: EphemeralSignalSubject = { ...KEY, actorJid: "a@s.whatsapp.net" };
    const b: EphemeralSignalSubject = { ...KEY, actorJid: "b@s.whatsapp.net" };
    expect(shouldPublishEphemeralSignal(a, "start", 0)).toBe(true);
    expect(shouldPublishEphemeralSignal(b, "start", 0)).toBe(true);
    expect(shouldPublishEphemeralSignal(a, "start", 10)).toBe(false);
  });

  test("the same subject built twice yields the same key", () => {
    expect(ephemeralSignalKey({ ...KEY, actorJid: "x@s.whatsapp.net" })).toBe(
      ephemeralSignalKey({ ...KEY, actorJid: "x@s.whatsapp.net" }),
    );
  });

  test("field values cannot run together into a colliding key", () => {
    // A naive `${a}:${b}` join lets one field's suffix impersonate the next.
    expect(
      ephemeralSignalKey({
        kind: "typing",
        companyId: "a",
        connectionId: "b|c",
        conversationJid: "d",
      }),
    ).not.toBe(
      ephemeralSignalKey({
        kind: "typing",
        companyId: "a",
        connectionId: "b",
        conversationJid: "c|d",
      }),
    );
  });
});
