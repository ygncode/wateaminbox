import type { Context } from "hono";
import { AuthError, serverError } from "../../lib/errors.js";

/**
 * Helper to extract device info from request
 */
export function getDeviceInfo(c: Context): {
  ipAddress?: string;
  userAgent?: string;
} {
  return {
    ipAddress:
      c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || undefined,
    userAgent: c.req.header("user-agent") || undefined,
  };
}

/**
 * Helper to handle AuthError responses consistently
 */
export function handleAuthError(
  c: Context,
  error: unknown,
  logger: { error: (obj: object, msg: string) => void },
  formatError: (err: unknown) => unknown,
  contextMessage: string,
) {
  if (error instanceof AuthError) {
    return c.json(
      { error: error.code, message: error.message },
      error.statusCode as 400 | 401 | 403 | 404 | 409,
    );
  }
  logger.error({ err: formatError(error) }, contextMessage);
  return serverError(c);
}
