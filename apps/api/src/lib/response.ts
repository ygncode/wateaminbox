import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Standard API response structure
 *
 * ## IMPORTANT: Always use these helpers instead of raw `c.json()`
 *
 * Response format conventions:
 * - Success with data: `successData(c, data)` → `{ data: T }`
 * - Success with pagination: `successPaginated(c, data, pagination)` → `{ data: T[], pagination }`
 * - Success message only: `successMessage(c, "message")` → `{ message: string }`
 * - Success with message + data: `successWithMessage(c, "message", data)` → `{ message, ...data }`
 * - Created resource: `created(c, data)` → `{ data: T }` (201 status)
 * - Validation error: `validationError(c, details)` → `{ error, details }`
 *
 * ## Anti-patterns to AVOID:
 * - `c.json({ success: true, ... })` - Don't use `success` field
 * - `c.json(data)` - Always wrap in `{ data }` for GET responses
 * - `c.json({ data, pagination })` - Use `successPaginated()` instead
 *
 * @example
 * // GET single resource
 * return successData(c, user);
 *
 * @example
 * // GET paginated list
 * return successPaginated(c, users, createPaginationMeta(total, users.length, { limit, offset }));
 *
 * @example
 * // POST create
 * return created(c, newUser);
 *
 * @example
 * // DELETE or action
 * return successMessage(c, "Resource deleted successfully");
 */

/**
 * Pagination metadata for list responses
 */
export interface PaginationMeta {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * Validation error detail
 */
export interface ValidationDetail {
  field: string;
  message: string;
}

/**
 * Return a success response with data
 * @param c - Hono context
 * @param data - Response data
 * @param status - HTTP status code (default: 200)
 */
export function successData<T>(
  c: Context,
  data: T,
  status: ContentfulStatusCode = 200,
) {
  return c.json({ data }, status);
}

/**
 * Return a success response with data and pagination
 * @param c - Hono context
 * @param data - Response data array
 * @param pagination - Pagination metadata
 */
export function successPaginated<T>(
  c: Context,
  data: T[],
  pagination: PaginationMeta,
) {
  return c.json({ data, pagination });
}

/**
 * Return a success response with a message
 * @param c - Hono context
 * @param message - Success message
 * @param status - HTTP status code (default: 200)
 */
export function successMessage(
  c: Context,
  message: string,
  status: ContentfulStatusCode = 200,
) {
  return c.json({ message }, status);
}

/**
 * Return a success response with a message and additional data
 * @param c - Hono context
 * @param message - Success message
 * @param data - Additional response data
 * @param status - HTTP status code (default: 200)
 */
export function successWithMessage<T extends Record<string, unknown>>(
  c: Context,
  message: string,
  data: T,
  status: ContentfulStatusCode = 200,
) {
  return c.json({ message, ...data }, status);
}

/**
 * Return a created response (201) with data
 * @param c - Hono context
 * @param data - Created resource data
 */
export function created<T>(c: Context, data: T) {
  return c.json({ data }, 201);
}

/**
 * Return a created response (201) with message and data
 * @param c - Hono context
 * @param message - Success message
 * @param data - Created resource data
 */
export function createdWithMessage<T extends Record<string, unknown>>(
  c: Context,
  message: string,
  data: T,
) {
  return c.json({ message, ...data }, 201);
}

/**
 * Return a validation error response (400)
 * @param c - Hono context
 * @param details - Array of validation error details
 */
export function validationError(c: Context, details: ValidationDetail[]) {
  return c.json({ error: "Validation Error", details }, 400);
}

/**
 * Format Zod validation errors into standard format
 * @param zodErrors - Zod error array from safeParse result
 */
export function formatZodErrors(
  zodErrors: Array<{ path: (string | number)[]; message: string }>,
): ValidationDetail[] {
  return zodErrors.map((e) => ({
    field: e.path.join("."),
    message: e.message,
  }));
}
