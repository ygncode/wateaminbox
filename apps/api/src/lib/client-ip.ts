import type { Context } from "hono";
import { env } from "./env.js";

const verifiedRequestIps = new WeakMap<Request, string>();

/** Called only by the Bun server adapter using Server.requestIP(). */
export function setVerifiedRequestIp(request: Request, ip: string): void {
  verifiedRequestIps.set(request, ip);
}

export function getVerifiedRequestIp(request: Request): string | undefined {
  return verifiedRequestIps.get(request);
}

/**
 * Resolve the client IP from the verified socket peer, accepting one
 * configured forwarding header only when the direct peer is an explicitly
 * trusted proxy.
 *
 * Every caller that records or keys on a client IP must use this. Reading
 * `x-forwarded-for` directly lets any client choose the value, which would
 * let a caller forge audit-log attribution or mint fresh rate-limit buckets.
 *
 * Returns undefined when the peer address is unknown (for example inside
 * unit tests that build a bare Request).
 */
export function resolveClientIp(c: Context): string | undefined {
  const remoteIp = getVerifiedRequestIp(c.req.raw);
  if (!remoteIp) return undefined;

  const trustedProxies = new Set(
    env.TRUSTED_PROXY_IPS.split(",")
      .map((ip) => ip.trim())
      .filter(Boolean),
  );
  if (!trustedProxies.has(remoteIp)) return remoteIp;

  const forwarded = c.req.header(env.TRUSTED_PROXY_IP_HEADER);
  const clientIp = forwarded?.split(",")[0]?.trim();
  return clientIp || remoteIp;
}
