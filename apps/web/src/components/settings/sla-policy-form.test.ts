import { describe, expect, test } from "bun:test";
import type {
  SlaScheduleException,
  SlaWeeklyScheduleDay,
} from "@wateaminbox/shared";
import {
  daysToScheduleInput,
  exceptionsToInput,
  formatIntervals,
  toEditableDays,
  toEditableExceptions,
} from "./sla-policy-form";

describe("toEditableDays / daysToScheduleInput round-trip", () => {
  test("fills all 7 weekdays even when the source schedule is empty", () => {
    const days = toEditableDays([]);
    expect(days).toHaveLength(7);
    expect(days.every((d) => !d.open)).toBe(true);
    expect(days.map((d) => d.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  test("round-trips a normal single-interval day", () => {
    const schedule: SlaWeeklyScheduleDay[] = [
      { weekday: 1, open: true, intervals: [{ start: "09:00", end: "17:00" }] },
    ];
    const days = toEditableDays(schedule);
    const monday = days.find((d) => d.weekday === 1)!;
    expect(monday.open).toBe(true);
    expect(monday.intervals).toHaveLength(1);
    expect(monday.intervals[0].start).toBe("09:00");
    expect(monday.intervals[0].end).toBe("17:00");
    expect(monday.intervals[0].untilMidnight).toBe(false);

    const roundTripped = daysToScheduleInput(days);
    const roundTrippedMonday = roundTripped.find((d) => d.weekday === 1)!;
    expect(roundTrippedMonday).toEqual({
      weekday: 1,
      open: true,
      intervals: [{ start: "09:00", end: "17:00" }],
    });
  });

  test("round-trips a multi-interval day (lunch-break split shift) losslessly", () => {
    const schedule: SlaWeeklyScheduleDay[] = [
      {
        weekday: 3,
        open: true,
        intervals: [
          { start: "09:00", end: "12:00" },
          { start: "13:00", end: "17:00" },
          { start: "18:00", end: "20:00" },
        ],
      },
    ];
    const days = toEditableDays(schedule);
    const wednesday = days.find((d) => d.weekday === 3)!;
    expect(wednesday.intervals).toHaveLength(3);

    const roundTripped = daysToScheduleInput(days);
    const roundTrippedWednesday = roundTripped.find((d) => d.weekday === 3)!;
    expect(roundTrippedWednesday.intervals).toEqual([
      { start: "09:00", end: "12:00" },
      { start: "13:00", end: "17:00" },
      { start: "18:00", end: "20:00" },
    ]);
  });

  test("represents a per-interval 24:00 sentinel as untilMidnight and back, alongside other intervals", () => {
    const schedule: SlaWeeklyScheduleDay[] = [
      {
        weekday: 2,
        open: true,
        intervals: [
          { start: "09:00", end: "12:00" },
          { start: "20:00", end: "24:00" },
        ],
      },
    ];
    const days = toEditableDays(schedule);
    const tuesday = days.find((d) => d.weekday === 2)!;
    expect(tuesday.intervals[0].untilMidnight).toBe(false);
    expect(tuesday.intervals[1].untilMidnight).toBe(true);

    const roundTripped = daysToScheduleInput(days);
    const roundTrippedTuesday = roundTripped.find((d) => d.weekday === 2)!;
    expect(roundTrippedTuesday.intervals).toEqual([
      { start: "09:00", end: "12:00" },
      { start: "20:00", end: "24:00" },
    ]);
  });

  test("a closed day always produces an empty intervals array, even if edited while open", () => {
    const days = toEditableDays([]);
    const closedDay = { ...days[0], open: false };
    const [result] = daysToScheduleInput([closedDay]);
    expect(result.open).toBe(false);
    expect(result.intervals).toEqual([]);
  });
});

describe("toEditableExceptions / exceptionsToInput round-trip", () => {
  test("round-trips a closed holiday exception", () => {
    const exceptions: SlaScheduleException[] = [
      { date: "2026-12-25", closed: true, label: "Christmas" },
    ];
    const editable = toEditableExceptions(exceptions);
    expect(editable[0].closed).toBe(true);
    expect(editable[0].label).toBe("Christmas");

    const [roundTripped] = exceptionsToInput(editable);
    expect(roundTripped).toEqual({
      date: "2026-12-25",
      closed: true,
      intervals: undefined,
      label: "Christmas",
    });
  });

  test("round-trips a single-interval custom-hours exception", () => {
    const exceptions: SlaScheduleException[] = [
      {
        date: "2026-12-24",
        closed: false,
        intervals: [{ start: "09:00", end: "13:00" }],
        label: "Half day",
      },
    ];
    const editable = toEditableExceptions(exceptions);
    expect(editable[0].intervals).toHaveLength(1);
    expect(editable[0].intervals[0].start).toBe("09:00");
    expect(editable[0].intervals[0].end).toBe("13:00");

    const [roundTripped] = exceptionsToInput(editable);
    expect(roundTripped.intervals).toEqual([{ start: "09:00", end: "13:00" }]);
  });

  test("round-trips a multi-interval custom-hours exception losslessly", () => {
    const exceptions: SlaScheduleException[] = [
      {
        date: "2026-12-31",
        closed: false,
        intervals: [
          { start: "09:00", end: "12:00" },
          { start: "14:00", end: "24:00" },
        ],
        label: "New Year's Eve",
      },
    ];
    const editable = toEditableExceptions(exceptions);
    expect(editable[0].intervals).toHaveLength(2);
    expect(editable[0].intervals[1].untilMidnight).toBe(true);

    const [roundTripped] = exceptionsToInput(editable);
    expect(roundTripped.intervals).toEqual([
      { start: "09:00", end: "12:00" },
      { start: "14:00", end: "24:00" },
    ]);
  });

  test("an empty label is omitted (not sent as an empty string)", () => {
    const editable = toEditableExceptions([
      { date: "2026-01-01", closed: true },
    ]);
    editable[0].label = "   ";
    const [result] = exceptionsToInput(editable);
    expect(result.label).toBeUndefined();
  });
});

describe("formatIntervals", () => {
  test("shows Closed for a closed day", () => {
    expect(formatIntervals({ weekday: 0, open: false, intervals: [] })).toBe(
      "Closed",
    );
  });

  test("joins multiple intervals for an open day", () => {
    expect(
      formatIntervals({
        weekday: 1,
        open: true,
        intervals: [
          { start: "09:00", end: "12:00" },
          { start: "13:00", end: "17:00" },
        ],
      }),
    ).toBe("09:00–12:00, 13:00–17:00");
  });
});
