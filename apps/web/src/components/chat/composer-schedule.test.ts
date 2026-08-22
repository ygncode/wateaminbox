import { describe, expect, it } from "bun:test";
import {
  canScheduleMessage,
  MIN_SCHEDULE_LEAD_MS,
  resolveScheduledAt,
} from "./composer-schedule";

const affordance = (
  overrides: Partial<Parameters<typeof canScheduleMessage>[0]> = {},
) =>
  canScheduleMessage({
    text: "Ready to send",
    isInputDisabled: false,
    hasContact: true,
    ...overrides,
  });

describe("canScheduleMessage", () => {
  it("offers scheduling once there is something to schedule", () => {
    expect(affordance()).toBe(true);
  });

  it("stays hidden for an empty composer, which is its usual state", () => {
    expect(affordance({ text: "" })).toBe(false);
  });

  it("treats every flavour of whitespace as empty", () => {
    // A message of blank lines must not open the picker and then be rejected
    // on submit; `trim()` covers NBSP and line terminators too.
    for (const text of [" ", "   ", "\t", "\n", "\r\n\r\n", " ", " \n\t "]) {
      expect([JSON.stringify(text), affordance({ text })]).toEqual([
        JSON.stringify(text),
        false,
      ]);
    }
  });

  it("counts text that merely starts or ends with whitespace", () => {
    expect(affordance({ text: "  hello  " })).toBe(true);
    expect(affordance({ text: "\n." })).toBe(true);
  });

  it("withdraws while the composer is disabled", () => {
    // Sending in flight, or the WhatsApp account disconnected.
    expect(affordance({ isInputDisabled: true })).toBe(false);
  });

  it("withdraws when no conversation is addressed", () => {
    expect(affordance({ hasContact: false })).toBe(false);
  });
});

describe("resolveScheduledAt", () => {
  const NOW = Date.parse("2026-08-22T10:00:00.000Z");
  const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

  it("converts a valid future time to UTC ISO for the API", () => {
    const result = resolveScheduledAt(at(2 * MIN_SCHEDULE_LEAD_MS), NOW);
    expect(result).toEqual({ ok: true, iso: at(2 * MIN_SCHEDULE_LEAD_MS) });
  });

  it("rejects an unparseable value rather than sending immediately", () => {
    expect(resolveScheduledAt("", NOW)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(resolveScheduledAt("not-a-date", NOW)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("holds the lead time the server also enforces", () => {
    expect(resolveScheduledAt(at(MIN_SCHEDULE_LEAD_MS), NOW).ok).toBe(true);
    expect(resolveScheduledAt(at(MIN_SCHEDULE_LEAD_MS - 1), NOW)).toEqual({
      ok: false,
      reason: "too-soon",
    });
  });

  it("rejects a time in the past", () => {
    expect(resolveScheduledAt(at(-60_000), NOW)).toEqual({
      ok: false,
      reason: "too-soon",
    });
  });
});
