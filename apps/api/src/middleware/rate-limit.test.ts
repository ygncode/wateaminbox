import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { setVerifiedRequestIp } from "../lib/client-ip.js";
import {
  type RateLimitStore,
  RateLimitStoreUnavailableError,
} from "../lib/rate-limit-store.js";
import { createRateLimitMiddleware } from "./rate-limit.js";

describe("rate limit client IP trust", () => {
  test("spoofed forwarding headers cannot create new rate-limit buckets", async () => {
    const counters = new Map<string, number>();
    const store: RateLimitStore = {
      async increment(key, limit) {
        const currentCount = (counters.get(key) ?? 0) + 1;
        counters.set(key, currentCount);
        return {
          allowed: currentCount <= limit,
          currentCount,
          limit,
          resetAt: Date.now() + 60_000,
          retryAfter: 60,
        };
      },
      async reset() {},
      async clear() {},
      async close() {},
    };

    const app = new Hono();
    app.use(
      "*",
      createRateLimitMiddleware({
        store,
        tier: { requests: 1, windowSeconds: 60 },
        keyStrategy: "ip",
      }),
    );
    app.post("/login", (c) => c.json({ success: true }));

    const first = new Request("http://localhost/login", {
      method: "POST",
      headers: { "x-forwarded-for": "198.51.100.1" },
    });
    const second = new Request("http://localhost/login", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.9" },
    });
    setVerifiedRequestIp(first, "192.0.2.10");
    setVerifiedRequestIp(second, "192.0.2.10");

    expect((await app.request(first)).status).toBe(200);
    expect((await app.request(second)).status).toBe(429);
    expect(counters.size).toBe(1);
  });

  test("maps a typed shared-store outage to a fail-closed 503", async () => {
    const store: RateLimitStore = {
      async increment() {
        throw new RateLimitStoreUnavailableError("database unavailable");
      },
      async reset() {},
      async clear() {},
      async close() {},
    };
    const app = new Hono();
    app.use(
      "*",
      createRateLimitMiddleware({
        store,
        tier: { requests: 10, windowSeconds: 60 },
        keyStrategy: "ip",
      }),
    );
    app.get("/", (c) => c.text("should not run"));

    const response = await app.request("/");
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("1");
    expect(await response.json()).toMatchObject({
      error: "Service Unavailable",
    });
  });
});
