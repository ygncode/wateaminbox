import type { Context } from "hono";
import { subtractDays, toDbDate } from "@whatsapp-web/shared";

/**
 * Date range result type
 */
export interface DateRange {
  startDate: Date;
  endDate: Date;
}

/**
 * Optional date range result type
 */
export interface OptionalDateRange {
  startDate?: Date;
  endDate?: Date;
}

/**
 * Extract date range from query parameters with defaults.
 *
 * If no dates are provided:
 * - endDate defaults to current date
 * - startDate defaults to (endDate - defaultDays)
 *
 * @example
 * ```ts
 * // Default to last 30 days
 * const { startDate, endDate } = extractDateRange(c, 30)
 *
 * // Default to last 7 days
 * const { startDate, endDate } = extractDateRange(c, 7)
 * ```
 *
 * @param c - The Hono context from a route handler
 * @param defaultDays - Number of days to subtract for default startDate (default: 30)
 * @returns The date range with startDate and endDate
 */
export function extractDateRange(c: Context, defaultDays = 30): DateRange {
  const startDateStr = c.req.query("startDate");
  const endDateStr = c.req.query("endDate");

  const endDate = endDateStr ? toDbDate(endDateStr) : toDbDate();
  const startDate = startDateStr
    ? toDbDate(startDateStr)
    : subtractDays(endDate, defaultDays).toDate();

  return { startDate, endDate };
}

/**
 * Extract optional date range from query parameters.
 *
 * Unlike `extractDateRange`, this returns undefined for dates not provided.
 * Useful for endpoints where date filtering is optional.
 *
 * @example
 * ```ts
 * const { startDate, endDate } = extractOptionalDateRange(c)
 * // startDate and endDate may be undefined
 * ```
 *
 * @param c - The Hono context from a route handler
 * @returns The optional date range (startDate and endDate may be undefined)
 */
export function extractOptionalDateRange(c: Context): OptionalDateRange {
  const startDateStr = c.req.query("startDate");
  const endDateStr = c.req.query("endDate");

  return {
    startDate: startDateStr ? toDbDate(startDateStr) : undefined,
    endDate: endDateStr ? toDbDate(endDateStr) : undefined,
  };
}
