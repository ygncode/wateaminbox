import { describe, expect, test } from "bun:test";
import { isExpiredEphemeralEvent } from "./ephemeral-expiry.js";

const now = Date.UTC(2026, 10, 3);
const published = (ageMs: number) => (now - ageMs) * 1_000_000;

describe("ephemeral broker age", () => {
  test("expires only stale presence and typing", () => {
    expect(isExpiredEphemeralEvent("presence", published(60_001), now)).toBe(
      true,
    );
    expect(isExpiredEphemeralEvent("presence", published(60_000), now)).toBe(
      false,
    );
    expect(isExpiredEphemeralEvent("typing", published(10_001), now)).toBe(
      true,
    );
    expect(isExpiredEphemeralEvent("typing", published(10_000), now)).toBe(
      false,
    );
  });

  test("durable conversation, history, and status data never expire here", () => {
    for (const type of [
      "message",
      "contact",
      "receipt",
      "reaction",
      "connected",
      "disconnected",
      "status",
      "sync_status",
      "history_sync_page",
      "send_confirmation",
      "qr",
    ]) {
      expect(
        isExpiredEphemeralEvent(type, published(7 * 86_400_000), now),
      ).toBe(false);
    }
  });

  test("unknown timestamp or backwards clock is not evidence of age", () => {
    for (const stamp of [
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      0,
      -1,
      published(-60_000),
    ]) {
      expect(isExpiredEphemeralEvent("presence", stamp, now)).toBe(false);
    }
  });
});
