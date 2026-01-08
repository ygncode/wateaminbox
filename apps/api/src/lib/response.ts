import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Standard API response structure
 *
 * Response format conventions:
 * - Success with data: { data: T, pagination?: PaginationMeta }
 * - Success with message: { message: string }
 * - Success with both: { message: string, ...data }
 * - Validation error: { error: string, details: Array<{ field: string, message: string }> }
 * - Error: { error: string, message?: string }
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
