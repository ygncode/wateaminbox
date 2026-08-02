import { describe, expect, test } from "bun:test";
import type { BulkJobProgress, BulkJobStatus } from "@wateaminbox/shared";
import {
  canRescheduleBulkJob,
  validateRescheduleTime,
} from "./broadcast-schedule";

const pristineProgress: BulkJobProgress = {
  total: 2,
  pending: 2,
  processing: 0,
  sent: 0,
  failed: 0,
  canceled: 0,
  skipped: 0,
};

function editable(status: BulkJobStatus, progress = pristineProgress) {
  return canRescheduleBulkJob({ status, progress });
}

describe("broadcast reschedule rules", () => {
  test("accepts a valid future local time and returns an ISO instant", () => {
    const value = "2030-01-01T12:00";
    const result = validateRescheduleTime(
      value,
      new Date("2030-01-01T10:00:00").getTime(),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.scheduledAt).toBe(new Date(value).toISOString());
    }
  });

  test("rejects past and too-near times", () => {
    const now = new Date("2030-01-01T10:00:00").getTime();
    expect(validateRescheduleTime("2030-01-01T09:59", now)).toEqual({
      ok: false,
      error: "Pick a time at least a minute from now",
    });
    expect(validateRescheduleTime("2030-01-01T10:00", now).ok).toBe(false);
  });

  test("allows only pristine scheduled jobs, never in-progress or terminal jobs", () => {
    expect(editable("scheduled")).toBe(true);
    expect(
      editable("scheduled", {
        ...pristineProgress,
        pending: 1,
        processing: 1,
      }),
    ).toBe(false);
    expect(editable("running")).toBe(false);
    expect(editable("completed")).toBe(false);
    expect(editable("completed_with_errors")).toBe(false);
    expect(editable("canceled")).toBe(false);
  });
});
