import type { Context } from "hono";
import { subtractDays, toDbDate } from "@wateaminbox/shared";
import { NotFoundError } from "./errors.js";

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

/**
 * Pagination parameters extracted from query string
 */
export interface PaginationParams {
  limit: number;
  offset: number;
}

/**
 * Extract pagination parameters from query string.
 *
 * Parses `limit` and `offset` query parameters with sensible defaults.
 * The limit is capped at maxLimit to prevent excessive data fetching.
 *
 * @example
 * ```ts
 * // Default to limit=50, offset=0
 * const { limit, offset } = extractPaginationParams(c)
 *
 * // Custom default limit
 * const { limit, offset } = extractPaginationParams(c, 20)
 *
 * // With custom max limit
 * const { limit, offset } = extractPaginationParams(c, 50, 200)
 * ```
 *
 * @param c - The Hono context from a route handler
 * @param defaultLimit - Default limit when not provided (default: 50)
 * @param maxLimit - Maximum allowed limit (default: 1000)
 * @returns The pagination parameters
 */
export function extractPaginationParams(
  c: Context,
  defaultLimit = 50,
  maxLimit = 1000,
): PaginationParams {
  const limitParam = c.req.query("limit");
  const offsetParam = c.req.query("offset");

  const rawLimit = limitParam ? parseInt(limitParam, 10) : defaultLimit;
  const rawOffset = offsetParam ? parseInt(offsetParam, 10) : 0;

  return {
    limit: Math.min(
      Math.max(1, isNaN(rawLimit) ? defaultLimit : rawLimit),
      maxLimit,
    ),
    offset: Math.max(0, isNaN(rawOffset) ? 0 : rawOffset),
  };
}

/**
 * Pagination response metadata
 */
export interface PaginationMeta {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * Create pagination metadata for API responses.
 *
 * @example
 * ```ts
 * const { limit, offset } = extractPaginationParams(c)
 * const { data, total } = await getContacts({ limit, offset })
 *
 * return c.json({
 *   data,
 *   pagination: createPaginationMeta(total, data.length, { limit, offset })
 * })
 * ```
 *
 * @param total - Total number of items available
 * @param returnedCount - Number of items returned in this response
 * @param params - The pagination parameters used for the query
 * @returns Pagination metadata for the response
 */
export function createPaginationMeta(
  total: number,
  returnedCount: number,
  params: PaginationParams,
): PaginationMeta {
  return {
    total,
    limit: params.limit,
    offset: params.offset,
    hasMore: params.offset + returnedCount < total,
  };
}

// =============================================================================
// Entity Helpers
// =============================================================================

/**
 * Require an entity to exist, throwing NotFoundError if null/undefined.
 *
 * This helper simplifies the common pattern of checking if an entity exists
 * and returning a 404 response if not. It throws a `NotFoundError` which
 * should be caught by the global error handler.
 *
 * @example
 * ```ts
 * // Before:
 * const contact = await tenantDb
 *   .selectFrom("contacts")
 *   .select(["id"])
 *   .where("id", "=", contactId)
 *   .executeTakeFirst();
 *
 * if (!contact) {
 *   return notFound(c, "Contact");
 * }
 *
 * // After:
 * const contact = requireEntity(
 *   await tenantDb
 *     .selectFrom("contacts")
 *     .select(["id"])
 *     .where("id", "=", contactId)
 *     .executeTakeFirst(),
 *   "Contact"
 * );
 * ```
 *
 * @param entity - The entity to check (result of a database query)
 * @param resourceName - Name of the resource for the error message (e.g., "Contact", "Tag")
 * @returns The entity if it exists
 * @throws NotFoundError if the entity is null or undefined
 */
export function requireEntity<T>(
  entity: T | null | undefined,
  resourceName: string,
): T {
  if (entity === null || entity === undefined) {
    throw new NotFoundError(resourceName);
  }
  return entity;
}
