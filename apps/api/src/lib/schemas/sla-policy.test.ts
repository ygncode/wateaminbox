import { describe, expect, test } from "bun:test";
import type { SlaWeeklySchedule } from "@wateaminbox/shared";
import { createSlaPolicySchema } from "./sla-policy.js";

function alwaysOpenSchedule(): SlaWeeklySchedule {
  return Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    open: true,
    intervals: [{ start: "00:00", end: "24:00" }],
  }));
}

function officeHoursSchedule(): SlaWeeklySchedule {
  return [
    { weekday: 0, open: false, intervals: [] },
    { weekday: 1, open: true, intervals: [{ start: "09:00", end: "17:00" }] },
    { weekday: 2, open: true, intervals: [{ start: "09:00", end: "17:00" }] },
    { weekday: 3, open: true, intervals: [{ start: "09:00", end: "17:00" }] },
    { weekday: 4, open: true, intervals: [{ start: "09:00", end: "17:00" }] },
    { weekday: 5, open: true, intervals: [{ start: "09:00", end: "17:00" }] },
    { weekday: 6, open: false, intervals: [] },
  ];
}

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    targetMinutes: 60,
    directResolutionTargetMinutes: 480,
    groupResponseTargetMinutes: 120,
    groupResolutionTargetMinutes: 960,
    timezone: "UTC",
    weeklySchedule: alwaysOpenSchedule(),
    exceptions: [],
    ...overrides,
  };
}

describe("createSlaPolicySchema - target minutes", () => {
  test("accepts the 1-1440 bound values", () => {
    expect(
      createSlaPolicySchema.safeParse(validInput({ targetMinutes: 1 })).success,
    ).toBe(true);
    expect(
      createSlaPolicySchema.safeParse(validInput({ targetMinutes: 1440 }))
        .success,
    ).toBe(true);
  });

  test("rejects out-of-range or non-integer targets", () => {
    expect(
      createSlaPolicySchema.safeParse(validInput({ targetMinutes: 0 })).success,
    ).toBe(false);
    expect(
      createSlaPolicySchema.safeParse(validInput({ targetMinutes: 1441 }))
        .success,
    ).toBe(false);
    expect(
      createSlaPolicySchema.safeParse(validInput({ targetMinutes: 30.5 }))
        .success,
    ).toBe(false);
  });
});

describe("createSlaPolicySchema - timezone", () => {
  test("accepts real IANA timezones", () => {
    expect(
      createSlaPolicySchema.safeParse(
        validInput({ timezone: "America/New_York" }),
      ).success,
    ).toBe(true);
    expect(
      createSlaPolicySchema.safeParse(validInput({ timezone: "Asia/Yangon" }))
        .success,
    ).toBe(true);
  });

  test("rejects an unrecognized timezone", () => {
    expect(
      createSlaPolicySchema.safeParse(validInput({ timezone: "Mars/Colony" }))
        .success,
    ).toBe(false);
    expect(
      createSlaPolicySchema.safeParse(validInput({ timezone: "" })).success,
    ).toBe(false);
  });
});

describe("createSlaPolicySchema - weekly schedule", () => {
  test("accepts a valid office-hours schedule with weekends explicitly closed", () => {
    const result = createSlaPolicySchema.safeParse(
      validInput({ weeklySchedule: officeHoursSchedule() }),
    );
    expect(result.success).toBe(true);
  });

  test("rejects a schedule missing a weekday", () => {
    const schedule = alwaysOpenSchedule().slice(0, 6);
    expect(
      createSlaPolicySchema.safeParse(validInput({ weeklySchedule: schedule }))
        .success,
    ).toBe(false);
  });

  test("rejects a schedule with a duplicated weekday", () => {
    const schedule = alwaysOpenSchedule();
    schedule[6] = { ...schedule[0] };
    expect(
      createSlaPolicySchema.safeParse(validInput({ weeklySchedule: schedule }))
        .success,
    ).toBe(false);
  });

  test("rejects an open day with no intervals", () => {
    const schedule = alwaysOpenSchedule();
    schedule[1] = { weekday: 1, open: true, intervals: [] };
    expect(
      createSlaPolicySchema.safeParse(validInput({ weeklySchedule: schedule }))
        .success,
    ).toBe(false);
  });

  test("rejects a closed day that still lists intervals", () => {
    const schedule = alwaysOpenSchedule();
    schedule[1] = {
      weekday: 1,
      open: false,
      intervals: [{ start: "09:00", end: "17:00" }],
    };
    expect(
      createSlaPolicySchema.safeParse(validInput({ weeklySchedule: schedule }))
        .success,
    ).toBe(false);
  });

  test("rejects overlapping intervals within a day", () => {
    const schedule = alwaysOpenSchedule();
    schedule[1] = {
      weekday: 1,
      open: true,
      intervals: [
        { start: "09:00", end: "13:00" },
        { start: "12:00", end: "17:00" },
      ],
    };
    expect(
      createSlaPolicySchema.safeParse(validInput({ weeklySchedule: schedule }))
        .success,
    ).toBe(false);
  });

  test("rejects out-of-order intervals within a day", () => {
    const schedule = alwaysOpenSchedule();
    schedule[1] = {
      weekday: 1,
      open: true,
      intervals: [
        { start: "14:00", end: "17:00" },
        { start: "09:00", end: "12:00" },
      ],
    };
    expect(
      createSlaPolicySchema.safeParse(validInput({ weeklySchedule: schedule }))
        .success,
    ).toBe(false);
  });

  test("rejects a malformed HH:mm value", () => {
    const schedule = alwaysOpenSchedule();
    schedule[1] = {
      weekday: 1,
      open: true,
      intervals: [{ start: "9:00", end: "17:00" }],
    };
    expect(
      createSlaPolicySchema.safeParse(validInput({ weeklySchedule: schedule }))
        .success,
    ).toBe(false);
  });

  test("rejects a schedule that is never open (no reachable SLA)", () => {
    const allClosed: SlaWeeklySchedule = Array.from(
      { length: 7 },
      (_, weekday) => ({
        weekday,
        open: false,
        intervals: [],
      }),
    );
    expect(
      createSlaPolicySchema.safeParse(validInput({ weeklySchedule: allClosed }))
        .success,
    ).toBe(false);
  });
});

describe("createSlaPolicySchema - exceptions", () => {
  test("accepts a closed holiday exception", () => {
    const result = createSlaPolicySchema.safeParse(
      validInput({
        exceptions: [{ date: "2026-12-25", closed: true, label: "Christmas" }],
      }),
    );
    expect(result.success).toBe(true);
  });

  test("accepts a custom-hours exception", () => {
    const result = createSlaPolicySchema.safeParse(
      validInput({
        exceptions: [
          {
            date: "2026-12-24",
            closed: false,
            intervals: [{ start: "09:00", end: "13:00" }],
            label: "Christmas Eve half day",
          },
        ],
      }),
    );
    expect(result.success).toBe(true);
  });

  test("rejects a closed exception that also lists intervals", () => {
    expect(
      createSlaPolicySchema.safeParse(
        validInput({
          exceptions: [
            {
              date: "2026-12-25",
              closed: true,
              intervals: [{ start: "09:00", end: "12:00" }],
            },
          ],
        }),
      ).success,
    ).toBe(false);
  });

  test("rejects a non-closed exception with no intervals", () => {
    expect(
      createSlaPolicySchema.safeParse(
        validInput({
          exceptions: [{ date: "2026-12-24", closed: false, intervals: [] }],
        }),
      ).success,
    ).toBe(false);
  });

  test("rejects an invalid calendar date", () => {
    expect(
      createSlaPolicySchema.safeParse(
        validInput({ exceptions: [{ date: "2026-02-30", closed: true }] }),
      ).success,
    ).toBe(false);
  });

  test("rejects duplicate exception dates", () => {
    expect(
      createSlaPolicySchema.safeParse(
        validInput({
          exceptions: [
            { date: "2026-12-25", closed: true },
            { date: "2026-12-25", closed: true, label: "duplicate" },
          ],
        }),
      ).success,
    ).toBe(false);
  });

  test("defaults exceptions to an empty array when omitted", () => {
    const result = createSlaPolicySchema.parse({
      targetMinutes: 60,
      directResolutionTargetMinutes: 480,
      groupResponseTargetMinutes: 120,
      groupResolutionTargetMinutes: 960,
      timezone: "UTC",
      weeklySchedule: alwaysOpenSchedule(),
    });
    expect(result.exceptions).toEqual([]);
  });
});
