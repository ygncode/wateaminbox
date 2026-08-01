/**
 * Bulk broadcast configuration.
 *
 * Environment variables (all optional):
 * - BULK_SEND_INTERVAL_MS         Gap between bulk sends on one connection
 *                                 (default 12000, hard minimum 10000).
 * - BULK_MAX_RECIPIENTS_PER_JOB   Recipient cap per job
 *                                 (default 100, hard maximum 500).
 * - BULK_DAILY_CAP_PER_CONNECTION Bulk sends per connection per UTC day
 *                                 (default 200, hard maximum 1000).
 *
 * The hard bounds are clamps, not validation errors: a dangerously low
 * interval or an absurd cap silently snaps to the nearest safe value so a
 * misconfigured deployment can never turn broadcasts into a spam cannon.
 * WhatsApp anti-spam enforcement is opaque and account-fatal, so every
 * default errs conservative.
 */

const HARD_MIN_SEND_INTERVAL_MS = 10_000;
const HARD_MAX_RECIPIENTS_PER_JOB = 500;
const HARD_MAX_DAILY_CAP = 1_000;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface BulkConfig {
  /** Minimum gap between two bulk sends on the same connection. */
  sendIntervalMs: number;
  /** Maximum recipients a single job may snapshot. */
  maxRecipientsPerJob: number;
  /** Maximum bulk sends per connection per day (database server's date). */
  dailyCapPerConnection: number;
}

export function getBulkConfig(): BulkConfig {
  return {
    sendIntervalMs: clamp(
      parsePositiveInt(process.env.BULK_SEND_INTERVAL_MS, 12_000),
      HARD_MIN_SEND_INTERVAL_MS,
      Number.MAX_SAFE_INTEGER,
    ),
    maxRecipientsPerJob: clamp(
      parsePositiveInt(process.env.BULK_MAX_RECIPIENTS_PER_JOB, 100),
      1,
      HARD_MAX_RECIPIENTS_PER_JOB,
    ),
    dailyCapPerConnection: clamp(
      parsePositiveInt(process.env.BULK_DAILY_CAP_PER_CONNECTION, 200),
      1,
      HARD_MAX_DAILY_CAP,
    ),
  };
}

export const bulkConfig = getBulkConfig();
