import { describe, expect, test } from "bun:test";
import type { SlaWeeklySchedule } from "@wateaminbox/shared";
import { MalformedSlaCalendarError } from "../../lib/errors.js";
import {
  assertValidCalendarShape,
  businessMinutesBetween,
  hhmmToMinutes,
  intervalsAreValidSortedAndNonOverlapping,
  isValidHHmm,
  isValidIanaTimeZone,
  isValidLocalDateString,
  OVERDUE_STRICT_EPSILON_MINUTES,
  type SlaCalendar,
} from "./calendar.js";

const OFFICE_HOURS_UTC: SlaWeeklySchedule = [
  { weekday: 0, open: false, intervals: [] }, // Sun
  { weekday: 1, open: true, intervals: [{ start: "09:00", end: "17:00" }] }, // Mon
  { weekday: 2, open: true, intervals: [{ start: "09:00", end: "17:00" }] }, // Tue
  { weekday: 3, open: true, intervals: [{ start: "09:00", end: "17:00" }] }, // Wed
  { weekday: 4, open: true, intervals: [{ start: "09:00", end: "17:00" }] }, // Thu
  { weekday: 5, open: true, intervals: [{ start: "09:00", end: "17:00" }] }, // Fri
  { weekday: 6, open: false, intervals: [] }, // Sat
];

const ALWAYS_OPEN: SlaWeeklySchedule = Array.from(
  { length: 7 },
  (_, weekday) => ({
    weekday,
    open: true,
    intervals: [{ start: "00:00", end: "24:00" }],
  }),
);

function calendar(overrides: Partial<SlaCalendar> = {}): SlaCalendar {
  return {
    timezone: "UTC",
    weeklySchedule: OFFICE_HOURS_UTC,
    exceptions: [],
    ...overrides,
  };
}

describe("businessMinutesBetween - basics", () => {
  test("returns 0 when end is at or before start", () => {
    const cal = calendar({ weeklySchedule: ALWAYS_OPEN });
    const t = new Date("2026-03-02T10:00:00Z");
    expect(businessMinutesBetween(cal, t, t)).toBe(0);
    expect(businessMinutesBetween(cal, t, new Date(t.getTime() - 60_000))).toBe(
      0,
    );
  });

  test("24/7 open calendar counts full wall-clock duration", () => {
    const cal = calendar({ weeklySchedule: ALWAYS_OPEN });
    const start = new Date("2026-03-02T10:00:00Z");
    const end = new Date("2026-03-02T11:30:00Z");
    expect(businessMinutesBetween(cal, start, end)).toBeCloseTo(90, 5);
  });

  test("counts only the overlap with a single open interval on the same day", () => {
    const cal = calendar();
    // 2026-03-02 is a Monday.
    const start = new Date("2026-03-02T10:00:00Z");
    const end = new Date("2026-03-02T12:00:00Z");
    expect(businessMinutesBetween(cal, start, end)).toBeCloseTo(120, 5);
  });
});

describe("businessMinutesBetween - weekend pause", () => {
  test("closed weekend hours are excluded from the elapsed total", () => {
    const cal = calendar();
    // Friday 2026-03-06 16:30 -> Monday 2026-03-09 09:30.
    const start = new Date("2026-03-06T16:30:00Z");
    const end = new Date("2026-03-09T09:30:00Z");
    // Friday: 16:30-17:00 = 30 min. Sat/Sun: closed. Monday: 09:00-09:30 = 30 min.
    expect(businessMinutesBetween(cal, start, end)).toBeCloseTo(60, 5);
  });

  test("a message sent entirely within a closed weekend has zero business minutes", () => {
    const cal = calendar();
    const start = new Date("2026-03-07T12:00:00Z"); // Saturday
    const end = new Date("2026-03-08T12:00:00Z"); // Sunday
    expect(businessMinutesBetween(cal, start, end)).toBe(0);
  });
});

describe("businessMinutesBetween - after-hours inbound", () => {
  test("starts consuming only from the next opening for an after-hours message", () => {
    const cal = calendar();
    // Monday 2026-03-02 20:00 (after close) -> Tuesday 2026-03-03 09:15.
    const start = new Date("2026-03-02T20:00:00Z");
    const end = new Date("2026-03-03T09:15:00Z");
    // Nothing counted Monday evening/night; Tuesday 09:00-09:15 = 15 min.
    expect(businessMinutesBetween(cal, start, end)).toBeCloseTo(15, 5);
  });

  test("a reply landing outside hours only counts up to the close of the open window", () => {
    const cal = calendar();
    // Monday 09:00 (open) -> Monday 20:00 (after close, same day).
    const start = new Date("2026-03-02T09:00:00Z");
    const end = new Date("2026-03-02T20:00:00Z");
    // Only 09:00-17:00 counts = 480 minutes, not the full 660 wall-clock minutes.
    expect(businessMinutesBetween(cal, start, end)).toBeCloseTo(480, 5);
  });
});

describe("businessMinutesBetween - holiday exceptions", () => {
  test("a fully-closed exception date excludes that date even though it's a normal weekday", () => {
    const cal = calendar({
      exceptions: [
        { date: "2026-03-04", closed: true, label: "Company holiday" },
      ],
    });
    // Wednesday 2026-03-04 is normally open 09:00-17:00.
    const start = new Date("2026-03-04T08:00:00Z");
    const end = new Date("2026-03-04T18:00:00Z");
    expect(businessMinutesBetween(cal, start, end)).toBe(0);
  });

  test("custom exception hours override the weekly schedule for that date only", () => {
    const cal = calendar({
      exceptions: [
        {
          date: "2026-03-04",
          closed: false,
          intervals: [{ start: "10:00", end: "14:00" }],
          label: "Half day",
        },
      ],
    });
    const start = new Date("2026-03-04T08:00:00Z");
    const end = new Date("2026-03-04T18:00:00Z");
    expect(businessMinutesBetween(cal, start, end)).toBeCloseTo(240, 5);

    // The following day (no exception) reverts to normal 09:00-17:00 hours.
    const nextDayStart = new Date("2026-03-05T08:00:00Z");
    const nextDayEnd = new Date("2026-03-05T18:00:00Z");
    expect(businessMinutesBetween(cal, nextDayStart, nextDayEnd)).toBeCloseTo(
      480,
      5,
    );
  });

  test("an exception can open a normally-closed weekend day", () => {
    const cal = calendar({
      exceptions: [
        {
          date: "2026-03-07", // Saturday, normally closed
          closed: false,
          intervals: [{ start: "10:00", end: "12:00" }],
          label: "Weekend coverage",
        },
      ],
    });
    const start = new Date("2026-03-07T00:00:00Z");
    const end = new Date("2026-03-08T00:00:00Z");
    expect(businessMinutesBetween(cal, start, end)).toBeCloseTo(120, 5);
  });
});

describe("businessMinutesBetween - DST transitions", () => {
  test("counts a full local business day correctly across a spring-forward transition", () => {
    // America/New_York springs forward on 2026-03-08 (2:00am -> 3:00am), a Sunday.
    // Use a calendar open every day 09:00-17:00 local to isolate the DST effect
    // from the weekly-schedule pause.
    const nyAlwaysOpen: SlaWeeklySchedule = Array.from(
      { length: 7 },
      (_, weekday) => ({
        weekday,
        open: true,
        intervals: [{ start: "09:00", end: "17:00" }],
      }),
    );
    const cal = calendar({
      timezone: "America/New_York",
      weeklySchedule: nyAlwaysOpen,
    });

    // Span two local business days that straddle the transition: Saturday
    // 2026-03-07 09:00 through Sunday 2026-03-08 17:00 local time.
    const start = new Date("2026-03-07T14:00:00Z"); // 09:00 EST (UTC-5)
    const end = new Date("2026-03-08T21:00:00Z"); // 17:00 EDT (UTC-4)

    // Each local day contributes exactly 8 business hours (480 min) regardless
    // of the underlying UTC offset shift, since 09:00-17:00 local doesn't span
    // the 2am transition moment itself.
    expect(businessMinutesBetween(cal, start, end)).toBeCloseTo(960, 5);
  });

  test("counts a full local business day correctly across a fall-back transition", () => {
    // America/New_York falls back on 2026-11-01 (2:00am EDT -> 1:00am EST), a Sunday.
    const nyAlwaysOpen: SlaWeeklySchedule = Array.from(
      { length: 7 },
      (_, weekday) => ({
        weekday,
        open: true,
        intervals: [{ start: "09:00", end: "17:00" }],
      }),
    );
    const cal = calendar({
      timezone: "America/New_York",
      weeklySchedule: nyAlwaysOpen,
    });

    // Saturday 2026-10-31 09:00 EDT (UTC-4) through Sunday 2026-11-01 17:00 EST (UTC-5).
    const start = new Date("2026-10-31T13:00:00Z");
    const end = new Date("2026-11-01T22:00:00Z");

    // Each local day still contributes exactly 8 business hours (480 min):
    // 09:00-17:00 local doesn't span the 1am/2am transition moment itself.
    expect(businessMinutesBetween(cal, start, end)).toBeCloseTo(960, 5);
  });

  test("a 24/7-open calendar measures 1380 minutes for a full local calendar day on the spring-forward date", () => {
    const cal = calendar({
      timezone: "America/New_York",
      weeklySchedule: ALWAYS_OPEN,
    });
    // Local midnight 2026-03-08 (EST, UTC-5) to local midnight 2026-03-09 (EDT, UTC-4).
    // That local calendar day is only 23 real hours long (clocks spring
    // forward at 2am), so an always-open calendar must report 1380
    // minutes, not a flat 1440 - this is the case that directly exercises
    // the transition instant itself, unlike the office-hours tests above.
    const start = new Date("2026-03-08T05:00:00Z");
    const end = new Date("2026-03-09T04:00:00Z");
    expect(businessMinutesBetween(cal, start, end)).toBeCloseTo(1380, 5);
  });

  test("a 24/7-open calendar measures 1500 minutes for a full local calendar day on the fall-back date", () => {
    const cal = calendar({
      timezone: "America/New_York",
      weeklySchedule: ALWAYS_OPEN,
    });
    // Local midnight 2026-11-01 (EDT, UTC-4) to local midnight 2026-11-02 (EST, UTC-5).
    // That local calendar day is 25 real hours long (clocks fall back at
    // 2am, repeating the 1-2am hour), so an always-open calendar must
    // report 1500 minutes.
    const start = new Date("2026-11-01T04:00:00Z");
    const end = new Date("2026-11-02T05:00:00Z");
    expect(businessMinutesBetween(cal, start, end)).toBeCloseTo(1500, 5);
  });

  test("resolves interval boundaries using the correct offset on each side of the transition", () => {
    const cal = calendar({ timezone: "America/New_York" });
    // Friday 2026-03-06 (still EST, UTC-5) 09:00-17:00 local.
    const fridayStart = new Date("2026-03-06T14:00:00Z");
    const fridayEnd = new Date("2026-03-06T22:00:00Z");
    expect(businessMinutesBetween(cal, fridayStart, fridayEnd)).toBeCloseTo(
      480,
      5,
    );

    // Monday 2026-03-09 (now EDT, UTC-4) 09:00-17:00 local.
    const mondayStart = new Date("2026-03-09T13:00:00Z");
    const mondayEnd = new Date("2026-03-09T21:00:00Z");
    expect(businessMinutesBetween(cal, mondayStart, mondayEnd)).toBeCloseTo(
      480,
      5,
    );
  });
});

describe("businessMinutesBetween - earlyExitAt", () => {
  test("stops walking once the accumulated total reaches the threshold", () => {
    const cal = calendar({ weeklySchedule: ALWAYS_OPEN });
    const start = new Date("2020-01-01T00:00:00Z");
    // Far-future end - without an early exit this would walk years of days.
    const end = new Date("2030-01-01T00:00:00Z");
    const result = businessMinutesBetween(cal, start, end, { earlyExitAt: 10 });
    expect(result).toBeGreaterThanOrEqual(10);
  });

  test("without earlyExitAt returns the exact total for a bounded range", () => {
    const cal = calendar({ weeklySchedule: ALWAYS_OPEN });
    const start = new Date("2026-01-01T00:00:00Z");
    const end = new Date("2026-01-02T00:00:00Z");
    expect(businessMinutesBetween(cal, start, end)).toBeCloseTo(1440, 5);
  });

  // 2026-06-01 is a Monday: OFFICE_HOURS_UTC is open 09:00-17:00 UTC that
  // day (480 business minutes), then closed until Tuesday 09:00 UTC.
  test("a bare-target earlyExitAt can stop exactly AT the target on a prior day boundary, silently under-reporting elapsed time relative to `end` - the false-negative this bug describes", () => {
    const cal = calendar();
    const start = new Date("2026-06-01T09:00:00Z"); // Monday 09:00
    const end = new Date("2026-06-02T10:00:00Z"); // Tuesday 10:00 - an hour into the next business day
    const target = 480; // exactly one full business day

    const buggy = businessMinutesBetween(cal, start, end, {
      earlyExitAt: target,
    });
    // Stops the instant Monday's 480 minutes are tallied, never walking
    // into Tuesday - even though real elapsed time (up to `end`) is 540.
    expect(buggy).toBe(480);
    expect(buggy > target).toBe(false);
  });

  test("a strict earlyExitAt (target + OVERDUE_STRICT_EPSILON_MINUTES) forces the walk past a day boundary that lands exactly on the target, correctly surfacing that more than the target has elapsed", () => {
    const cal = calendar();
    const start = new Date("2026-06-01T09:00:00Z"); // Monday 09:00
    const end = new Date("2026-06-02T10:00:00Z"); // Tuesday 10:00
    const target = 480;

    const strict = businessMinutesBetween(cal, start, end, {
      earlyExitAt: target + OVERDUE_STRICT_EPSILON_MINUTES,
    });
    expect(strict).toBeCloseTo(540, 5);
    expect(strict > target).toBe(true);
  });

  test("exactly-at-target with no further business time available (end coincides with the target) is still reported as exactly the target, not inflated by the epsilon", () => {
    const cal = calendar();
    const start = new Date("2026-06-01T09:00:00Z"); // Monday 09:00
    const end = new Date("2026-06-01T17:00:00Z"); // Monday 17:00 - exactly the target, and `end` itself
    const target = 480;

    const strict = businessMinutesBetween(cal, start, end, {
      earlyExitAt: target + OVERDUE_STRICT_EPSILON_MINUTES,
    });
    expect(strict).toBe(480);
    expect(strict > target).toBe(false);
  });
});

describe("validation helpers", () => {
  test("isValidHHmm accepts 00:00 through 23:59 and the 24:00 sentinel", () => {
    expect(isValidHHmm("00:00")).toBe(true);
    expect(isValidHHmm("23:59")).toBe(true);
    expect(isValidHHmm("24:00")).toBe(true);
    expect(isValidHHmm("24:01")).toBe(false);
    expect(isValidHHmm("9:00")).toBe(false);
    expect(isValidHHmm("25:00")).toBe(false);
    expect(isValidHHmm("noon")).toBe(false);
  });

  test("hhmmToMinutes converts correctly, including the 24:00 sentinel", () => {
    expect(hhmmToMinutes("00:00")).toBe(0);
    expect(hhmmToMinutes("09:30")).toBe(570);
    expect(hhmmToMinutes("24:00")).toBe(1440);
  });

  test("intervalsAreValidSortedAndNonOverlapping accepts sorted, touching, non-overlapping intervals", () => {
    expect(
      intervalsAreValidSortedAndNonOverlapping([
        { start: "09:00", end: "12:00" },
        { start: "12:00", end: "13:00" },
        { start: "14:00", end: "24:00" },
      ]),
    ).toBe(true);
  });

  test("intervalsAreValidSortedAndNonOverlapping rejects overlaps, bad ordering, and invalid times", () => {
    expect(
      intervalsAreValidSortedAndNonOverlapping([
        { start: "09:00", end: "13:00" },
        { start: "12:00", end: "14:00" },
      ]),
    ).toBe(false);
    expect(
      intervalsAreValidSortedAndNonOverlapping([
        { start: "14:00", end: "16:00" },
        { start: "09:00", end: "12:00" },
      ]),
    ).toBe(false);
    expect(
      intervalsAreValidSortedAndNonOverlapping([
        { start: "17:00", end: "09:00" },
      ]),
    ).toBe(false);
    expect(
      intervalsAreValidSortedAndNonOverlapping([
        { start: "24:00", end: "24:00" },
      ]),
    ).toBe(false);
    expect(
      intervalsAreValidSortedAndNonOverlapping([
        { start: "9:00", end: "17:00" },
      ]),
    ).toBe(false);
  });

  test("isValidIanaTimeZone accepts real zones and rejects garbage", () => {
    expect(isValidIanaTimeZone("UTC")).toBe(true);
    expect(isValidIanaTimeZone("America/New_York")).toBe(true);
    expect(isValidIanaTimeZone("Asia/Yangon")).toBe(true);
    expect(isValidIanaTimeZone("Not/AZone")).toBe(false);
    expect(isValidIanaTimeZone("")).toBe(false);
  });

  test("isValidLocalDateString accepts real calendar dates and rejects invalid ones", () => {
    expect(isValidLocalDateString("2026-03-04")).toBe(true);
    expect(isValidLocalDateString("2026-02-29")).toBe(false); // 2026 is not a leap year
    expect(isValidLocalDateString("2024-02-29")).toBe(true); // 2024 is a leap year
    expect(isValidLocalDateString("2026-13-01")).toBe(false);
    expect(isValidLocalDateString("2026-03-4")).toBe(false);
    expect(isValidLocalDateString("not-a-date")).toBe(false);
  });
});

describe("assertValidCalendarShape / malformed persisted data", () => {
  test("accepts a well-formed calendar", () => {
    expect(() => assertValidCalendarShape(calendar())).not.toThrow();
  });

  test("throws when the weekly schedule is missing a weekday (e.g. only 6 entries)", () => {
    const malformed = calendar({
      weeklySchedule: OFFICE_HOURS_UTC.slice(0, 6),
    });
    expect(() => assertValidCalendarShape(malformed)).toThrow(
      MalformedSlaCalendarError,
    );
  });

  test("throws when a weekday is duplicated (leaving another one missing)", () => {
    const schedule = OFFICE_HOURS_UTC.slice();
    schedule[6] = { ...schedule[0] }; // duplicate Sunday, no Saturday
    expect(() =>
      assertValidCalendarShape(calendar({ weeklySchedule: schedule })),
    ).toThrow(MalformedSlaCalendarError);
  });

  test("throws when a day is marked open but has no intervals", () => {
    const schedule = OFFICE_HOURS_UTC.map((day) =>
      day.weekday === 1 ? { ...day, intervals: [] } : day,
    );
    expect(() =>
      assertValidCalendarShape(calendar({ weeklySchedule: schedule })),
    ).toThrow(MalformedSlaCalendarError);
  });

  test("throws when a non-closed exception has no intervals", () => {
    const malformed = calendar({
      exceptions: [{ date: "2026-12-25", closed: false }],
    });
    expect(() => assertValidCalendarShape(malformed)).toThrow(
      MalformedSlaCalendarError,
    );
  });

  test("a closed exception with no intervals is valid (does not throw)", () => {
    const ok = calendar({
      exceptions: [{ date: "2026-12-25", closed: true, label: "Christmas" }],
    });
    expect(() => assertValidCalendarShape(ok)).not.toThrow();
  });

  test("businessMinutesBetween raises instead of silently treating a malformed day as closed", () => {
    const schedule = OFFICE_HOURS_UTC.slice(0, 6); // missing Saturday
    const malformed = calendar({ weeklySchedule: schedule });
    const start = new Date("2026-03-02T09:00:00Z");
    const end = new Date("2026-03-02T12:00:00Z");
    expect(() => businessMinutesBetween(malformed, start, end)).toThrow(
      MalformedSlaCalendarError,
    );
  });
});
