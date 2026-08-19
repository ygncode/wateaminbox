import { beforeEach, describe, expect, it } from "bun:test";
import {
  clearConnectionTransition,
  consumeConnectionTransition,
  expectConnectionTransition,
  MAX_PENDING_TRANSITIONS,
  resetConnectionTransitions,
  TRANSITION_TTL_MS,
} from "./connection-analytics";

const T0 = 1_700_000_000_000;

describe("connection transition tracking", () => {
  beforeEach(() => {
    resetConnectionTransitions();
  });

  it("returns the pending mode once per transition", () => {
    expectConnectionTransition("conn-1", "new", T0);
    expect(consumeConnectionTransition("conn-1", T0 + 1_000)).toBe("new");
    // Duplicate "connected" publications must not double-count.
    expect(consumeConnectionTransition("conn-1", T0 + 2_000)).toBeNull();
  });

  it("reports nothing for transitions the user did not initiate", () => {
    expect(consumeConnectionTransition("worker-recovered", T0)).toBeNull();
  });

  it("keeps modes per connection and honors the latest request", () => {
    expectConnectionTransition("conn-1", "new", T0);
    expectConnectionTransition("conn-2", "reconnect", T0);
    expectConnectionTransition("conn-1", "reconnect", T0);
    expect(consumeConnectionTransition("conn-1", T0)).toBe("reconnect");
    expect(consumeConnectionTransition("conn-2", T0)).toBe("reconnect");
  });

  it("expires stale expectations so a much later connect is not attributed", () => {
    expectConnectionTransition("conn-1", "new", T0);
    expect(
      consumeConnectionTransition("conn-1", T0 + TRANSITION_TTL_MS),
    ).toBeNull();
    // Expired entries are also removed on consume.
    expect(consumeConnectionTransition("conn-1", T0)).toBeNull();
  });

  it("refreshes the expiry when a flow is re-registered", () => {
    expectConnectionTransition("conn-1", "new", T0);
    expectConnectionTransition("conn-1", "new", T0 + TRANSITION_TTL_MS - 1);
    expect(
      consumeConnectionTransition("conn-1", T0 + TRANSITION_TTL_MS + 1_000),
    ).toBe("new");
  });

  it("supports explicit clearing when a flow ends without connecting", () => {
    expectConnectionTransition("conn-1", "reconnect", T0);
    clearConnectionTransition("conn-1");
    expect(consumeConnectionTransition("conn-1", T0)).toBeNull();
  });

  it("stays bounded by evicting the oldest expectation past the cap", () => {
    for (let index = 0; index <= MAX_PENDING_TRANSITIONS; index += 1) {
      expectConnectionTransition(`conn-${index}`, "new", T0 + index);
    }
    // conn-0 was the oldest and must have been evicted; the newest survives.
    expect(consumeConnectionTransition("conn-0", T0)).toBeNull();
    expect(
      consumeConnectionTransition(`conn-${MAX_PENDING_TRANSITIONS}`, T0),
    ).toBe("new");
  });

  it("treats a re-registered connection as most recent for eviction", () => {
    expectConnectionTransition("conn-keep", "new", T0);
    for (let index = 0; index < MAX_PENDING_TRANSITIONS - 1; index += 1) {
      expectConnectionTransition(`conn-${index}`, "new", T0 + index);
    }
    // Refresh conn-keep, then push one more entry over the cap: the eviction
    // must drop the stalest entry (conn-0), not the refreshed one.
    expectConnectionTransition("conn-keep", "reconnect", T0 + 1_000);
    expectConnectionTransition("conn-extra", "new", T0 + 2_000);
    expect(consumeConnectionTransition("conn-0", T0)).toBeNull();
    expect(consumeConnectionTransition("conn-keep", T0 + 3_000)).toBe(
      "reconnect",
    );
  });
});
