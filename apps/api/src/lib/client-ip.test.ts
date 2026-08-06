import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { getClientIp as getAuditClientIp } from "../services/audit.service.js";
import { getClientIp as getRateLimitClientIp } from "../middleware/rate-limit.js";
import { resolveClientIp, setVerifiedRequestIp } from "./client-ip.js";

/**
 * Drive a request through Hono so the handler sees a real Context, and return
 * whatever the supplied resolver produced.
 */
async function resolveThrough(
  resolver: (c: Parameters<typeof resolveClientIp>[0]) => string | undefined,
  headers: Record<string, string>,
  peerIp?: string,
): Promise<string | undefined> {
  let seen: string | undefined;
  const app = new Hono();
  app.get("/probe", (c) => {
    seen = resolver(c);
    return c.json({ ok: true });
  });

  const request = new Request("http://localhost/probe", { headers });
  if (peerIp) setVerifiedRequestIp(request, peerIp);
  await app.request(request);
  return seen;
}

describe("client IP resolution ignores untrusted forwarding headers", () => {
  test("a spoofed x-forwarded-for never overrides the socket peer", async () => {
    const ip = await resolveThrough(
      resolveClientIp,
      { "x-forwarded-for": "198.51.100.7", "x-real-ip": "198.51.100.8" },
      "192.0.2.10",
    );
    expect(ip).toBe("192.0.2.10");
  });

  test("audit entries record the socket peer, not a caller-chosen value", async () => {
    // Forging this value would let any authenticated member write misleading
    // attribution into their own tenant's audit log.
    const ip = await resolveThrough(
      getAuditClientIp,
      { "x-forwarded-for": "203.0.113.9" },
      "192.0.2.11",
    );
    expect(ip).toBe("192.0.2.11");
  });

  test("audit and rate limiting agree on the resolved address", async () => {
    const headers = { "x-forwarded-for": "203.0.113.9" };
    const auditIp = await resolveThrough(
      getAuditClientIp,
      headers,
      "192.0.2.12",
    );
    const rateLimitIp = await resolveThrough(
      getRateLimitClientIp,
      headers,
      "192.0.2.12",
    );
    expect(auditIp).toBe("192.0.2.12");
    expect(rateLimitIp).toBe("192.0.2.12");
  });

  test("an unknown peer yields no audit IP rather than a header value", async () => {
    const ip = await resolveThrough(getAuditClientIp, {
      "x-forwarded-for": "198.51.100.7",
    });
    expect(ip).toBeUndefined();
  });

  test("rate limiting falls back to a constant bucket for an unknown peer", async () => {
    const ip = await resolveThrough(getRateLimitClientIp, {
      "x-forwarded-for": "198.51.100.7",
    });
    expect(ip).toBe("unknown");
  });
});
