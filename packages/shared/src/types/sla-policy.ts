/**
 * Calendar-aware SLA policy types.
 *
 * A company's SLA policy carries four targets under one shared calendar
 * (IANA timezone + weekly open-hours schedule + manual date exceptions):
 * direct response, direct resolution, group response, and group
 * resolution. Direct chats use the direct targets; ALL group conversations
 * share the group targets workspace-wide (there is no per-group override).
 * "Response" measures each live inbound turn while a case is active;
 * "resolution" measures case-open to manual-resolve.
 *
 * Policies are versioned and immutable: editing the SLA creates a new
 * policy version that activates immediately, but every already-recorded
 * (or in-progress) response episode or open case keeps using whichever
 * policy version was active when it started - edits never rewrite
 * historical (or already-open) analytics.
 */

/** Bounds for a response target (direct or group), in minutes. */
export const SLA_TARGET_MINUTES_MIN = 1;
export const SLA_TARGET_MINUTES_MAX = 1440;

/**
 * Bounds for a resolution target (direct or group), in minutes. Wider than
 * the response bound - resolution spans an entire case, which can
 * reasonably run for days of business time.
 */
export const SLA_RESOLUTION_TARGET_MINUTES_MIN = 1;
export const SLA_RESOLUTION_TARGET_MINUTES_MAX = 20160; // 14 business days

/**
 * A local wall-clock interval, "HH:mm" 24-hour format, half-open [start, end).
 * `end` may be the sentinel `"24:00"` to mean "local midnight, i.e. the
 * start of the next calendar day" - this is the only way to express a
 * window that runs to the end of the day without ambiguity against `"00:00"`
 * (which always means the start of a day).
 */
export interface SlaTimeInterval {
  start: string;
  end: string;
}

/** One weekday's open/closed state and, if open, its local time windows. */
export interface SlaWeeklyScheduleDay {
  /** 0 = Sunday ... 6 = Saturday (matches `Date#getDay`/`dayjs#day`). */
  weekday: number;
  open: boolean;
  /** Non-overlapping, sorted intervals. Required (non-empty) when `open`. */
  intervals: SlaTimeInterval[];
}

/** All 7 local weekdays, each appearing exactly once. */
export type SlaWeeklySchedule = SlaWeeklyScheduleDay[];

/**
 * A manual override for one specific local calendar date (`YYYY-MM-DD`,
 * interpreted in the policy's timezone) - either a full closure (holiday)
 * or custom hours that replace the weekly schedule for that date only.
 */
export interface SlaScheduleException {
  date: string;
  closed: boolean;
  /** Required (non-empty) when `closed` is false; must be empty/omitted when closed. */
  intervals?: SlaTimeInterval[];
  label?: string;
}

/** A versioned SLA policy as returned by the API. */
export interface SlaPolicy {
  id: string;
  companyId: string;
  /** Direct-chat response target (field name kept for compatibility). */
  targetMinutes: number;
  directResolutionTargetMinutes: number;
  groupResponseTargetMinutes: number;
  groupResolutionTargetMinutes: number;
  timezone: string;
  weeklySchedule: SlaWeeklySchedule;
  exceptions: SlaScheduleException[];
  effectiveFrom: string;
  createdBy: string | null;
  createdAt: string;
}

/** Input for creating a new (immediately-active) SLA policy version. */
export interface CreateSlaPolicyInput {
  targetMinutes: number;
  directResolutionTargetMinutes: number;
  groupResponseTargetMinutes: number;
  groupResolutionTargetMinutes: number;
  timezone: string;
  weeklySchedule: SlaWeeklySchedule;
  exceptions?: SlaScheduleException[];
}

/** A default weekly schedule that is open 24/7 - used for backfill/new companies. */
export const DEFAULT_SLA_WEEKLY_SCHEDULE: SlaWeeklySchedule = Array.from(
  { length: 7 },
  (_, weekday) => ({
    weekday,
    open: true,
    intervals: [{ start: "00:00", end: "24:00" }],
  }),
);

export const DEFAULT_SLA_TARGET_MINUTES = 60;
export const DEFAULT_SLA_TIMEZONE = "UTC";
/** Conservative defaults for newly-seeded companies; documented in migration 061. */
export const DEFAULT_SLA_DIRECT_RESOLUTION_TARGET_MINUTES = 480;
export const DEFAULT_SLA_GROUP_RESPONSE_TARGET_MINUTES = 120;
export const DEFAULT_SLA_GROUP_RESOLUTION_TARGET_MINUTES = 960;
