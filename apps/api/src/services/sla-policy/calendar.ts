/**
 * Business-hours calendar math for calendar-aware SLA policies.
 *
 * A policy defines a weekly open-hours schedule (in an IANA timezone) plus
 * manual date exceptions. "Business minutes" between two instants is the
 * total wall-clock time that falls inside the policy's open windows -
 * closed time (nights, weekends, holidays) is simply skipped, so the SLA
 * clock pauses outside open hours and resumes at the next opening.
 *
 * Interval semantics: every interval is a local, half-open window
 * `[start, end)` in "HH:mm" 24-hour format. `end` may be the sentinel
 * `"24:00"`, meaning "local midnight - the start of the next calendar
 * day"; this is the only way to express "open until end of day" without
 * colliding with `"00:00"`, which always means the start of a day.
 *
 * DST correctness: local wall-clock boundaries (e.g. "09:00 America/New_York
 * on 2026-03-08") are converted to exact UTC instants per calendar day via
 * dayjs's timezone plugin, so the correct UTC offset is resolved for that
 * specific date - including on the days a DST transition happens.
 */

import type {
  SlaScheduleException,
  SlaTimeInterval,
  SlaWeeklySchedule,
} from "@wateaminbox/shared";
import { dayjs } from "@wateaminbox/shared";
import timezoneOf from "dayjs/plugin/timezone.js";
import { MalformedSlaCalendarError } from "../../lib/errors.js";

dayjs.extend(timezoneOf);

export interface SlaCalendar {
  timezone: string;
  weeklySchedule: SlaWeeklySchedule;
  exceptions: SlaScheduleException[];
}

/** Safety bound on how many calendar days `businessMinutesBetween` will walk. */
const MAX_DAYS_WALKED = 3660; // ~10 years

/**
 * Validates that a calendar's shape is internally consistent enough for
 * `resolveDayIntervals` to answer "open or closed" correctly. This should
 * be unreachable in practice - `createSlaPolicySchema` enforces all of this
 * on write - but this module is a shared primitive with callers that read
 * persisted JSON straight out of the database (episode-resolution.ts), so
 * it does not trust that data implicitly. A day/exception this can't
 * resolve confidently throws rather than silently falling back to
 * "closed," which would understate business time and misrepresent SLA
 * compliance without any indication anything was wrong.
 */
export function assertValidCalendarShape(calendar: SlaCalendar): void {
  const weekdays = calendar.weeklySchedule.map((day) => day.weekday);
  const uniqueWeekdays = new Set(weekdays);
  if (
    calendar.weeklySchedule.length !== 7 ||
    uniqueWeekdays.size !== 7 ||
    weekdays.some((w) => !Number.isInteger(w) || w < 0 || w > 6)
  ) {
    throw new MalformedSlaCalendarError(
      `weeklySchedule must include each weekday 0-6 exactly once, got [${weekdays.join(", ")}]`,
    );
  }
  for (const day of calendar.weeklySchedule) {
    if (day.open && (!day.intervals || day.intervals.length === 0)) {
      throw new MalformedSlaCalendarError(
        `weekday ${day.weekday} is marked open but has no intervals`,
      );
    }
  }
  for (const exception of calendar.exceptions) {
    if (
      !exception.closed &&
      (!exception.intervals || exception.intervals.length === 0)
    ) {
      throw new MalformedSlaCalendarError(
        `exception ${exception.date} is marked open (not closed) but has no intervals`,
      );
    }
  }
}

export function isValidIanaTimeZone(timeZone: string): boolean {
  try {
    // Throws RangeError for an unrecognized IANA zone name.
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

const HHMM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;

export function isValidHHmm(value: string): boolean {
  return HHMM_PATTERN.test(value);
}

/** Minutes since local midnight; `"24:00"` maps to 1440. */
export function hhmmToMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

/**
 * True when every interval is individually valid (start < end, "24:00" only
 * as an end), sorted ascending by start, and non-overlapping (touching
 * endpoints, e.g. 09:00-12:00 then 12:00-13:00, are allowed).
 */
export function intervalsAreValidSortedAndNonOverlapping(
  intervals: SlaTimeInterval[],
): boolean {
  let previousEndMinutes = -1;
  for (const interval of intervals) {
    if (!isValidHHmm(interval.start) || !isValidHHmm(interval.end)) {
      return false;
    }
    const startMinutes = hhmmToMinutes(interval.start);
    const endMinutes = hhmmToMinutes(interval.end);
    if (startMinutes >= endMinutes) return false; // "24:00" can't be a start
    if (startMinutes < previousEndMinutes) return false;
    previousEndMinutes = endMinutes;
  }
  return true;
}

export function isValidLocalDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const parsed = dayjs.utc(`${value}T00:00:00Z`);
  return (
    parsed.isValid() &&
    parsed.year() === y &&
    parsed.month() + 1 === m &&
    parsed.date() === d
  );
}

function findExceptionForDate(
  exceptions: SlaScheduleException[],
  dateStr: string,
): SlaScheduleException | undefined {
  return exceptions.find((exception) => exception.date === dateStr);
}

function findWeeklyDay(schedule: SlaWeeklySchedule, weekday: number) {
  return schedule.find((day) => day.weekday === weekday);
}

/** Local calendar date (YYYY-MM-DD) and weekday (0=Sun..6=Sat) for an instant, in a timezone. */
function localDateParts(instant: Date, timeZone: string) {
  const zoned = dayjs.tz(instant, timeZone);
  return { dateStr: zoned.format("YYYY-MM-DD"), weekday: zoned.day() };
}

/**
 * Resolves the open intervals that apply to one local calendar date: a
 * matching exception always wins (fully closed, or its own custom hours);
 * otherwise falls back to the weekly schedule for that date's weekday.
 */
function resolveDayIntervals(
  calendar: SlaCalendar,
  dateStr: string,
  weekday: number,
): SlaTimeInterval[] {
  const exception = findExceptionForDate(calendar.exceptions, dateStr);
  if (exception) {
    return exception.closed ? [] : (exception.intervals ?? []);
  }
  const weeklyDay = findWeeklyDay(calendar.weeklySchedule, weekday);
  return weeklyDay?.open ? weeklyDay.intervals : [];
}

/** Converts a local "HH:mm" wall-clock time on a given local date to its exact UTC instant. */
/** Advances a plain YYYY-MM-DD calendar date string by one day (timezone-independent). */
function nextCalendarDateString(dateStr: string): string {
  return dayjs.utc(dateStr).add(1, "day").format("YYYY-MM-DD");
}

function zonedIntervalBoundToUtc(
  dateStr: string,
  hhmm: string,
  timeZone: string,
): Date {
  if (hhmm === "24:00") {
    return dayjs
      .tz(`${nextCalendarDateString(dateStr)} 00:00`, timeZone)
      .toDate();
  }
  return dayjs.tz(`${dateStr} ${hhmm}`, timeZone).toDate();
}

export interface BusinessMinutesOptions {
  /**
   * If provided, stop walking as soon as the accumulated total reaches this
   * many minutes and return early (the exact returned value is then only a
   * lower bound >= this threshold, not the precise elapsed time). Used for
   * "is this already overdue" checks so a message pending for months
   * doesn't force a full day-by-day walk to "now".
   *
   * IMPORTANT for strict "> target" overdue checks: a day's business
   * intervals are summed in full before this threshold is tested, so the
   * walk can stop with the accumulated total landing exactly ON
   * `earlyExitAt` (e.g. an interval ends the instant the running total
   * reaches the target) even though strictly more business time exists
   * later, up to the real `end`. Comparing that early-exited value with a
   * bare `> target` would then falsely read as compliant. Callers doing a
   * strict overdue check must pass `target + OVERDUE_STRICT_EPSILON_MINUTES`
   * here (see below) so an early exit can only ever fire once the total has
   * *strictly* exceeded the target.
   */
  earlyExitAt?: number;
}

/**
 * Add to a target when computing `earlyExitAt` for a strict "already overdue"
 * check (`elapsed > target`, not `elapsed >= target`) - see the caveat on
 * `BusinessMinutesOptions.earlyExitAt`. Deliberately far smaller than any
 * realistic SLA target (minutes) while staying well above floating-point
 * noise from millisecond-precision minute math.
 */
export const OVERDUE_STRICT_EPSILON_MINUTES = 1e-4;

/**
 * Total business (open-hours) minutes elapsed between `start` and `end`.
 * Returns 0 if `end <= start`. Time outside any open interval (nights,
 * closed weekdays, holidays) is not counted - the SLA clock effectively
 * pauses there and resumes at the next opening.
 */
export function businessMinutesBetween(
  calendar: SlaCalendar,
  start: Date,
  end: Date,
  opts: BusinessMinutesOptions = {},
): number {
  assertValidCalendarShape(calendar);
  if (end.getTime() <= start.getTime()) return 0;

  let totalMinutes = 0;
  let cursor = localDateParts(start, calendar.timezone).dateStr;
  const endTime = end.getTime();
  const startTime = start.getTime();

  for (let dayIndex = 0; dayIndex < MAX_DAYS_WALKED; dayIndex++) {
    const weekday = dayjs.tz(cursor, calendar.timezone).day();
    const dayStartUtc = dayjs
      .tz(cursor, calendar.timezone)
      .startOf("day")
      .toDate()
      .getTime();
    if (dayStartUtc > endTime) break;

    const intervals = resolveDayIntervals(calendar, cursor, weekday);
    for (const interval of intervals) {
      const intervalStart = zonedIntervalBoundToUtc(
        cursor,
        interval.start,
        calendar.timezone,
      ).getTime();
      const intervalEnd = zonedIntervalBoundToUtc(
        cursor,
        interval.end,
        calendar.timezone,
      ).getTime();

      const overlapStart = Math.max(intervalStart, startTime);
      const overlapEnd = Math.min(intervalEnd, endTime);
      if (overlapEnd > overlapStart) {
        totalMinutes += (overlapEnd - overlapStart) / 60000;
      }
    }

    if (opts.earlyExitAt !== undefined && totalMinutes >= opts.earlyExitAt) {
      return totalMinutes;
    }

    const nextCursor = nextCalendarDateString(cursor);
    const nextDayStartUtc = dayjs
      .tz(nextCursor, calendar.timezone)
      .startOf("day")
      .toDate()
      .getTime();
    if (nextDayStartUtc > endTime) break;
    cursor = nextCursor;
  }

  return totalMinutes;
}
