import type { BulkJob } from "@wateaminbox/shared";
import { dayjs } from "@wateaminbox/shared";

/** Client-side slack above the API's 30-second minimum. */
export const RESCHEDULE_MIN_LEAD_MS = 60_000;

export function toLocalScheduleInput(iso: string): string {
  return dayjs(iso).format("YYYY-MM-DDTHH:mm");
}

export type ScheduleValidationResult =
  | { ok: true; scheduledAt: string }
  | { ok: false; error: string };

/** Parse a datetime-local value in the viewer's timezone and enforce lead time. */
export function validateRescheduleTime(
  value: string,
  nowMs: number = Date.now(),
): ScheduleValidationResult {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) {
    return { ok: false, error: "Enter a valid date and time" };
  }
  if (parsed.getTime() - nowMs < RESCHEDULE_MIN_LEAD_MS) {
    return { ok: false, error: "Pick a time at least a minute from now" };
  }
  return { ok: true, scheduledAt: parsed.toISOString() };
}

/** Mirrors the server's pristine-job gate for whether the edit action is shown. */
export function canRescheduleBulkJob(
  job: Pick<BulkJob, "status" | "progress">,
): boolean {
  return (
    job.status === "scheduled" &&
    job.progress.processing === 0 &&
    job.progress.sent === 0 &&
    job.progress.failed === 0 &&
    job.progress.canceled === 0
  );
}
