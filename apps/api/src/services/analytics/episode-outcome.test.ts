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
    caseId: "case-1",
    caseKind: "direct",
    inboundTime: new Date("2026-01-01T00:00:00Z"),
    responseTime: null,
    displayInboundTime: new Date("2026-01-01T00:00:00Z"),
    displayResponseTime: null,
    respondedBy: null,
    caseResolvedAt: null,
    caseExclusionOutcome: null,
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

describe("computeEpisodeOutcome - exact target boundary (unanswered, still-open case)", () => {
  test("an unanswered episode exactly at the target age is NOT yet overdue", () => {
    const inboundTime = new Date("2026-01-01T00:00:00Z");
    const now = new Date(inboundTime.getTime() + 30 * 60_000); // exactly 30 min elapsed
    const outcome = computeEpisodeOutcome(row({ inboundTime }), 30, now);
    expect(outcome?.isOverdueUnanswered).toBe(false);
    expect(outcome?.isTerminal).toBe(false);
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

describe("computeEpisodeOutcome - terminal (case-closed) unanswered episodes", () => {
  test("handled-terminal unanswered is an immediate breach even well under the target age", () => {
    const inboundTime = new Date("2026-01-01T00:00:00Z");
    const caseResolvedAt = new Date(inboundTime.getTime() + 5 * 60_000); // only 5 min elapsed
    const now = new Date(inboundTime.getTime() + 5 * 60_000);
    const outcome = computeEpisodeOutcome(
      row({ inboundTime, caseResolvedAt, caseExclusionOutcome: null }),
      30,
      now,
    );
    expect(outcome?.isTerminal).toBe(true);
    expect(outcome?.isOverdueUnanswered).toBe(true);
    expect(outcome?.exclusionOutcome).toBeNull();
  });

  test("closed-time stability: magnitude never keeps growing after the case closes", () => {
    const inboundTime = new Date("2026-01-01T00:00:00Z");
    const caseResolvedAt = new Date(inboundTime.getTime() + 10 * 60_000);
    const rightAfterClose = computeEpisodeOutcome(
      row({ inboundTime, caseResolvedAt }),
      30,
      caseResolvedAt,
    );
    const muchLater = computeEpisodeOutcome(
      row({ inboundTime, caseResolvedAt }),
      30,
      new Date(caseResolvedAt.getTime() + 1000 * 60 * 60 * 24 * 30), // 30 days later
    );
    expect(rightAfterClose?.isOverdueUnanswered).toBe(true);
    expect(muchLater?.isOverdueUnanswered).toBe(true);
    // Both must agree the breach is real, and the underlying "now" passed
    // in must not change the classification once the case is terminal.
    expect(rightAfterClose?.isOverdueUnanswered).toBe(
      muchLater?.isOverdueUnanswered,
    );
  });

  test("a valid exclusion outcome (no_reply_needed/spam/duplicate) is excluded, not a breach", () => {
    const inboundTime = new Date("2026-01-01T00:00:00Z");
    const caseResolvedAt = new Date(inboundTime.getTime() + 5 * 60_000);
    const outcome = computeEpisodeOutcome(
      row({
        inboundTime,
        caseResolvedAt,
        caseExclusionOutcome: "no_reply_needed",
      }),
      30,
      caseResolvedAt,
    );
    expect(outcome?.isTerminal).toBe(true);
    expect(outcome?.isOverdueUnanswered).toBe(false);
    expect(outcome?.exclusionOutcome).toBe("no_reply_needed");
  });

  test("an answered episode in a since-closed case is unaffected by termination", () => {
    const inboundTime = new Date("2026-01-01T00:00:00Z");
    const responseTime = new Date(inboundTime.getTime() + 10 * 60_000);
    const caseResolvedAt = new Date(inboundTime.getTime() + 20 * 60_000);
    const outcome = computeEpisodeOutcome(
      row({ inboundTime, responseTime, caseResolvedAt }),
      30,
      caseResolvedAt,
    );
    expect(outcome?.responseMinutes).toBeCloseTo(10, 5);
    expect(outcome?.isOverdueUnanswered).toBe(false);
    expect(outcome?.isTerminal).toBe(true);
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
