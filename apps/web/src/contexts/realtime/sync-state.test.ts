import { describe, expect, test } from "bun:test";
import {
  endSync,
  reconcileSyncState,
  startSync,
  updateSyncProgress,
} from "./sync-state";

describe("realtime sync state", () => {
  test("late progress cannot recreate a completed sync", () => {
    let state = new Map();
    state = startSync(state, "connection-1");
    state = updateSyncProgress(state, "connection-1", 12, 120);
    state = endSync(state, "connection-1");
    const completedState = state;

    state = updateSyncProgress(state, "connection-1", 99, 999);

    expect(state).toBe(completedState);
    expect(state.size).toBe(0);
  });

  test("out-of-order progress cannot move counters backwards", () => {
    let state = startSync(new Map(), "connection-1");
    state = updateSyncProgress(state, "connection-1", 307, 328);
    state = updateSyncProgress(state, "connection-1", 297, 320);

    expect(state.get("connection-1")?.conversations).toBe(307);
    expect(state.get("connection-1")?.messages).toBe(328);
  });

  test("interruption ends the blocking lifecycle", () => {
    let state = startSync(new Map(), "connection-1");
    state = endSync(state, "connection-1");
    expect(state.size).toBe(0);
  });

  test("server reconciliation removes stale local entries and preserves progress", () => {
    const startedAt = new Date("2026-01-01T00:00:00Z");
    let state = startSync(new Map(), "active", startedAt);
    state = updateSyncProgress(state, "active", 42, 420);
    state = startSync(state, "already-completed", startedAt);

    state = reconcileSyncState(state, [
      {
        id: "active",
        updated_at: "2026-01-01T00:01:00Z",
        sync_conversation_count: 40,
        sync_message_count: 400,
      },
      {
        id: "server-only",
        updated_at: "2026-01-01T00:02:00Z",
        sync_conversation_count: 7,
        sync_message_count: 70,
      },
    ]);

    expect([...state.keys()]).toEqual(["active", "server-only"]);
    expect(state.get("active")?.conversations).toBe(42);
    expect(state.get("active")?.messages).toBe(420);
    expect(state.get("active")?.startedAt).toEqual(startedAt);
    expect(state.get("server-only")?.conversations).toBe(7);
    expect(state.get("server-only")?.messages).toBe(70);
  });
});
