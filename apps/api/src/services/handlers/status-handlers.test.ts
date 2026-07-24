import { describe, expect, test } from "bun:test";
import {
  getPersistedSyncCounters,
  shouldApplySyncStatusEvent,
} from "./status-handlers.js";

describe("sync status lifecycle ordering", () => {
  test("requires start before progress or completion", () => {
    expect(shouldApplySyncStatusEvent(null, "progress")).toBe(false);
    expect(shouldApplySyncStatusEvent(null, "completed")).toBe(false);
    expect(shouldApplySyncStatusEvent("completed", "progress")).toBe(false);
    expect(shouldApplySyncStatusEvent("interrupted", "completed")).toBe(false);
  });

  test("accepts active lifecycle events", () => {
    expect(shouldApplySyncStatusEvent(null, "starting")).toBe(true);
    expect(shouldApplySyncStatusEvent("completed", "starting")).toBe(true);
    expect(shouldApplySyncStatusEvent("interrupted", "starting")).toBe(true);
    expect(shouldApplySyncStatusEvent("syncing", "progress")).toBe(true);
    expect(shouldApplySyncStatusEvent("syncing", "completed")).toBe(true);
  });

  test("persists progress counters and resets them for a new sync", () => {
    expect(getPersistedSyncCounters("starting", 328, 307)).toEqual({
      sync_message_count: 0,
      sync_conversation_count: 0,
    });
    expect(getPersistedSyncCounters("progress", 328, 307)).toEqual({
      sync_message_count: 328,
      sync_conversation_count: 307,
    });
  });

  test("late progress cannot resurrect a completed lifecycle", () => {
    let status: "syncing" | "completed" | null = null;
    const apply = (incoming: "starting" | "progress" | "completed") => {
      if (!shouldApplySyncStatusEvent(status, incoming)) return;
      if (incoming === "starting") status = "syncing";
      if (incoming === "completed") status = "completed";
    };

    apply("starting");
    apply("progress");
    apply("completed");
    apply("progress");

    expect(String(status)).toBe("completed");
  });
});
