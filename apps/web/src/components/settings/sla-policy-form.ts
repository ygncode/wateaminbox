/**
 * Pure form <-> API-shape conversions for the SLA policy editor.
 * Kept separate from SlaPolicySettings.tsx so this logic (in particular
 * multi-interval days/exceptions and the "24:00 = until midnight" special
 * case) is unit-testable without rendering.
 *
 * Every open weekday and every custom-hours exception can carry MULTIPLE
 * intervals (e.g. a lunch-break split shift, "09:00-12:00, 13:00-17:00").
 * Each interval tracks its own `untilMidnight` flag so an interval's end
 * can independently be the `"24:00"` end-of-day sentinel.
 */

import type {
  SlaScheduleException,
  SlaTimeInterval,
  SlaWeeklyScheduleDay,
} from "@wateaminbox/shared";

export interface EditableInterval {
  key: string;
  start: string;
  end: string;
  untilMidnight: boolean;
}

export interface EditableDay {
  weekday: number;
  open: boolean;
  intervals: EditableInterval[];
}

export interface EditableException {
  key: string;
  date: string;
  closed: boolean;
  label: string;
  intervals: EditableInterval[];
}

let intervalKeySeq = 0;
/** Stable-enough React list key without requiring `crypto.randomUUID()` in tests. */
function nextIntervalKey(): string {
  intervalKeySeq += 1;
  return `interval-${intervalKeySeq}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function newEditableInterval(
  start = "09:00",
  end = "17:00",
): EditableInterval {
  return { key: nextIntervalKey(), start, end, untilMidnight: false };
}

function toEditableInterval(interval: SlaTimeInterval): EditableInterval {
  return {
    key: nextIntervalKey(),
    start: interval.start,
    end: interval.end === "24:00" ? "23:59" : interval.end,
    untilMidnight: interval.end === "24:00",
  };
}

function fromEditableInterval(interval: EditableInterval): SlaTimeInterval {
  return {
    start: interval.start,
    end: interval.untilMidnight ? "24:00" : interval.end,
  };
}

export function toEditableDays(
  schedule: SlaWeeklyScheduleDay[],
): EditableDay[] {
  return Array.from({ length: 7 }, (_, weekday) => {
    const day = schedule.find((d) => d.weekday === weekday);
    const intervals = (day?.intervals ?? []).map(toEditableInterval);
    return {
      weekday,
      open: day?.open ?? false,
      intervals: intervals.length > 0 ? intervals : [newEditableInterval()],
    };
  });
}

export function toEditableExceptions(
  exceptions: SlaScheduleException[],
): EditableException[] {
  return exceptions.map((exception) => {
    const intervals = (exception.intervals ?? []).map(toEditableInterval);
    return {
      key: `exception-${exception.date}`,
      date: exception.date,
      closed: exception.closed,
      label: exception.label ?? "",
      intervals: intervals.length > 0 ? intervals : [newEditableInterval()],
    };
  });
}

/**
 * Every interval belonging to an open day is preserved losslessly - this is
 * the inverse of `toEditableDays` and round-trips a multi-interval policy
 * exactly (see sla-policy-form.test.ts).
 */
export function daysToScheduleInput(
  days: EditableDay[],
): SlaWeeklyScheduleDay[] {
  return days.map((day) => ({
    weekday: day.weekday,
    open: day.open,
    intervals: day.open ? day.intervals.map(fromEditableInterval) : [],
  }));
}

export function exceptionsToInput(
  exceptions: EditableException[],
): SlaScheduleException[] {
  return exceptions.map((exception) => ({
    date: exception.date,
    closed: exception.closed,
    intervals: exception.closed
      ? undefined
      : exception.intervals.map(fromEditableInterval),
    label: exception.label.trim() || undefined,
  }));
}

export function formatIntervals(day: SlaWeeklyScheduleDay): string {
  if (!day.open || day.intervals.length === 0) return "Closed";
  return day.intervals
    .map((interval) => `${interval.start}–${interval.end}`)
    .join(", ");
}
