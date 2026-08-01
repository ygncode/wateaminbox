import {
  SLA_TARGET_MINUTES_MAX,
  SLA_TARGET_MINUTES_MIN,
} from "@wateaminbox/shared";
import { z } from "zod";
import {
  intervalsAreValidSortedAndNonOverlapping,
  isValidHHmm,
  isValidIanaTimeZone,
  isValidLocalDateString,
} from "../../services/sla-policy/calendar.js";

export const targetMinutesSchema = z
  .number()
  .int("SLA target must be a whole number of minutes")
  .min(
    SLA_TARGET_MINUTES_MIN,
    `SLA target must be at least ${SLA_TARGET_MINUTES_MIN} minute`,
  )
  .max(
    SLA_TARGET_MINUTES_MAX,
    `SLA target must be at most ${SLA_TARGET_MINUTES_MAX} minutes`,
  );

export const timezoneSchema = z
  .string()
  .trim()
  .min(1, "Timezone is required")
  .max(64, "Timezone is too long")
  .refine(
    isValidIanaTimeZone,
    "Must be a valid IANA timezone (e.g. America/New_York)",
  );

const timeIntervalSchema = z
  .object({
    start: z
      .string()
      .refine(isValidHHmm, "start must be HH:mm (24h), e.g. 09:00"),
    end: z
      .string()
      .refine(
        isValidHHmm,
        "end must be HH:mm (24h) or the 24:00 end-of-day sentinel",
      ),
  })
  .refine((interval) => interval.start !== "24:00", {
    message: "An interval cannot start at 24:00",
    path: ["start"],
  })
  .refine((interval) => interval.start < interval.end, {
    message: "Interval end must be after start",
    path: ["end"],
  });

const intervalListSchema = z
  .array(timeIntervalSchema)
  .max(12, "Too many intervals for one day")
  .refine(
    intervalsAreValidSortedAndNonOverlapping,
    "Intervals must be sorted by start time and must not overlap",
  );

const weeklyScheduleDaySchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    open: z.boolean(),
    intervals: intervalListSchema,
  })
  .refine((day) => !day.open || day.intervals.length > 0, {
    message: "An open weekday needs at least one interval",
    path: ["intervals"],
  })
  .refine((day) => day.open || day.intervals.length === 0, {
    message: "A closed weekday must not include intervals",
    path: ["intervals"],
  });

export const weeklyScheduleSchema = z
  .array(weeklyScheduleDaySchema)
  .length(7, "The weekly schedule must include all 7 weekdays")
  .refine((days) => {
    const weekdays = days.map((d) => d.weekday);
    return (
      new Set(weekdays).size === 7 && weekdays.every((w) => w >= 0 && w <= 6)
    );
  }, "The weekly schedule must include each weekday (0-6) exactly once")
  .refine(
    (days) => days.some((d) => d.open && d.intervals.length > 0),
    "At least one weekday must be open with an interval - a calendar that is never open cannot receive replies within SLA",
  );

const scheduleExceptionSchema = z
  .object({
    date: z
      .string()
      .refine(
        isValidLocalDateString,
        "date must be a valid calendar date (YYYY-MM-DD)",
      ),
    closed: z.boolean(),
    intervals: intervalListSchema.optional(),
    label: z.string().trim().max(120).optional(),
  })
  .refine((exception) => !exception.closed || !exception.intervals?.length, {
    message: "A closed exception must not include intervals",
    path: ["intervals"],
  })
  .refine(
    (exception) => exception.closed || (exception.intervals?.length ?? 0) > 0,
    {
      message: "A custom-hours exception needs at least one interval",
      path: ["intervals"],
    },
  );

export const exceptionsSchema = z
  .array(scheduleExceptionSchema)
  .max(366, "Too many exception dates")
  .refine(
    (exceptions) =>
      new Set(exceptions.map((e) => e.date)).size === exceptions.length,
    "Exception dates must be unique",
  );

/**
 * Schema for creating a new (immediately-active) SLA policy version.
 * Policies are immutable - "editing" the SLA means posting a new version,
 * validated the same way as the first one.
 */
export const createSlaPolicySchema = z.object({
  targetMinutes: targetMinutesSchema,
  timezone: timezoneSchema,
  weeklySchedule: weeklyScheduleSchema,
  exceptions: exceptionsSchema.default([]),
});

export type CreateSlaPolicyInput = z.infer<typeof createSlaPolicySchema>;
