import { describe, expect, test } from "bun:test";
import { computeEpisodeOutcome } from "./episode-outcome.js";
import type { ResolvedEpisodeRow } from "./episode-resolution.js";

const ALWAYS_OPEN = Array.from({ length: 7 }, (_, weekday) => ({
  weekday,
  open: true,
  intervals: [{ start: "00:00", end: "24:00" }],
}));

function row(overrides: Partial<ResolvedEpisodeRow> = {}): ResolvedEpisodeRow {
  return {
    contactId: "contact-1",
    contactName: "Test contact",
    inboundTime: new Date("2026-01-01T00:00:00Z"),
    responseTime: null,
    respondedBy: null,
    policy: {
      id: "policy-1",
      targetMinutes: 60,
      calendar: {
        timezone: "UTC",
        weeklySchedule: ALWAYS_OPEN,
        exceptions: [],
      },
    },
    ...overrides,
  };
}

describe("computeEpisodeOutcome - exact target boundary (answered episodes)", () => {
  test("a reply exactly at the target is within SLA, not a breach", () => {
    const inboundTime = new Date("2026-01-01T00:00:00Z");
    const responseTime = new Date(inboundTime.getTime() + 30 * 60_000);
    const outcome = computeEpisodeOutcome(
      row({ inboundTime, responseTime }),
      30,
      new Date("2026-01-01T05:00:00Z"),
    );
    expect(outcome?.responseMinutes).toBeCloseTo(30, 5);
    expect(outcome?.effectiveTargetMinutes).toBe(30);
    // "within SLA" is response_minutes <= target - exact equality must be true.
    expect((outcome?.responseMinutes ?? Infinity) <= 30).toBe(true);
  });

  test("a reply one minute over the target is not within SLA", () => {
    const inboundTime = new Date("2026-01-01T00:00:00Z");
    const responseTime = new Date(inboundTime.getTime() + 31 * 60_000);
    const outcome = computeEpisodeOutcome(
      row({ inboundTime, responseTime }),
      30,
      new Date("2026-01-01T05:00:00Z"),
    );
    expect(outcome?.responseMinutes).toBeCloseTo(31, 5);
    expect((outcome?.responseMinutes ?? 0) <= 30).toBe(false);
  });
});

describe("computeEpisodeOutcome - exact target boundary (unanswered episodes)", () => {
  test("an unanswered episode exactly at the target age is NOT yet overdue", () => {
    const inboundTime = new Date("2026-01-01T00:00:00Z");
    const now = new Date(inboundTime.getTime() + 30 * 60_000); // exactly 30 min elapsed
    const outcome = computeEpisodeOutcome(row({ inboundTime }), 30, now);
    expect(outcome?.isOverdueUnanswered).toBe(false);
  });

  test("an unanswered episode one minute past the target age IS overdue", () => {
    const inboundTime = new Date("2026-01-01T00:00:00Z");
    const now = new Date(inboundTime.getTime() + 31 * 60_000); // 31 min elapsed
    const outcome = computeEpisodeOutcome(row({ inboundTime }), 30, now);
    expect(outcome?.isOverdueUnanswered).toBe(true);
  });

  test("an unanswered episode one minute before the target age is NOT overdue", () => {
    const inboundTime = new Date("2026-01-01T00:00:00Z");
    const now = new Date(inboundTime.getTime() + 29 * 60_000); // 29 min elapsed
    const outcome = computeEpisodeOutcome(row({ inboundTime }), 30, now);
    expect(outcome?.isOverdueUnanswered).toBe(false);
  });

  test("uses the episode's own historical policy target when no override is given", () => {
    const inboundTime = new Date("2026-01-01T00:00:00Z");
    const now = new Date(inboundTime.getTime() + 60 * 60_000); // exactly 60 min elapsed
    const outcome = computeEpisodeOutcome(
      row({
        inboundTime,
        policy: {
          id: "p",
          targetMinutes: 60,
          calendar: {
            timezone: "UTC",
            weeklySchedule: ALWAYS_OPEN,
            exceptions: [],
          },
        },
      }),
      undefined,
      now,
    );
    expect(outcome?.effectiveTargetMinutes).toBe(60);
    expect(outcome?.isOverdueUnanswered).toBe(false);
  });
});

describe("computeEpisodeOutcome - missing policy", () => {
  test("returns null when the episode has no resolvable policy", () => {
    const outcome = computeEpisodeOutcome(
      row({ policy: null }),
      30,
      new Date(),
    );
    expect(outcome).toBeNull();
  });
});
