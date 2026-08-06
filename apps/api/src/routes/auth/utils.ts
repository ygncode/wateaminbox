import type { Context } from "hono";
import { resolveClientIp } from "../../lib/client-ip.js";
import { AuthError, serverError } from "../../lib/errors.js";

/** Session rows are shown to users verbatim, so bound what a client can store. */
const MAX_USER_AGENT_LENGTH = 512;

/**
 * Helper to extract device info from request.
 *
 * The IP comes from the verified socket peer rather than a client-supplied
 * forwarding header: users read this value on the "active sessions" screen to
 * decide whether a session is theirs, so a spoofable value is worse than none.
 */
export function getDeviceInfo(c: Context): {
  ipAddress?: string;
  userAgent?: string;
} {
  return {
    ipAddress: resolveClientIp(c),
    userAgent:
      c.req.header("user-agent")?.slice(0, MAX_USER_AGENT_LENGTH) || undefined,
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
