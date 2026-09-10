import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { WhatsAppEvent } from "../lib/nats/types/base.js";
import { isHistoryBarrier } from "./history-apply-barrier.service.js";

describe("history barrier classification", () => {
  const build = (
    type: WhatsAppEvent["type"],
    payload: unknown,
  ): WhatsAppEvent => ({
    contractVersion: 1,
    eventId: crypto.randomUUID(),
    companyId: "company",
    connectionId: "connection",
    type,
    payload,
    timestamp: new Date().toISOString(),
  });

  test("classifies completion markers as barriers", () => {
    expect(isHistoryBarrier(build("history_sync_page", {}))).toBe(true);
    expect(
      isHistoryBarrier(build("sync_status", { status: "completed" })),
    ).toBe(true);
  });

  test("does not classify progress or non-history events as barriers", () => {
    expect(isHistoryBarrier(build("sync_status", { status: "starting" }))).toBe(
      false,
    );
    expect(isHistoryBarrier(build("sync_status", { status: "progress" }))).toBe(
      false,
    );
    expect(isHistoryBarrier(build("message", { isHistorySync: true }))).toBe(
      false,
    );
    expect(isHistoryBarrier(build("contact", {}))).toBe(false);
  });
});

describe("history barrier drain race contract", () => {
  // `canApplyHistoryBarrier` is the single gate shared by the critical loop and
  // the drain. Once the critical loop applies + deletes a marker row, the
  // JOIN's `marker` side has no rows, so `waiting` alone would be false and the
  // drain would re-broadcast a duplicate `history:loaded`. The gate must also
  // require the marker row to still exist, treating a deleted marker as already
  // applied. This locks that contract in default `bun test`; the behavioral
  // proof lives in the RUN_DB_INTEGRATION suite.
  test("requires the marker row to still exist before returning ready", () => {
    const source = readFileSync(
      new URL("./history-apply-barrier.service.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("AS exists");
    expect(source).toContain("AS waiting");
    expect(source).toContain("return exists && !waiting;");
    expect(source).toContain(
      "if (!event.eventId || !isHistoryBarrier(event)) return true;",
    );
  });
});
