import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { RateLimitStore } from "../lib/rate-limit-store.js";
import { createRateLimitMiddleware } from "../middleware/rate-limit.js";
import { channelIngressRateLimitKey } from "./channel-ingress.js";

/**
 * The webhook limiter keys by route (one channel account), not by IP: two
 * bots called from the same provider address get independent buckets, and a
 * flooded bot is throttled without touching the other.
 */
const LIMIT = 3;
const counts = new Map<string, number>();
const store: RateLimitStore = {
  async increment(key, limit) {
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    return {
      allowed: count <= limit,
      currentCount: count,
      limit,
      resetAt: Math.floor(Date.now() / 1000) + 60,
      retryAfter: 60,
    };
  },
  async reset() {},
  async clear() {},
  async close() {},
};

const app = new Hono();
app.use(
  "/:provider/:routeKey",
  createRateLimitMiddleware({
    store,
    tier: { requests: LIMIT, windowSeconds: 60 },
    keyStrategy: "ip",
    generateKey: channelIngressRateLimitKey,
  }),
);
app.post("/:provider/:routeKey", (c) => c.json({ ok: true }));

const ROUTE_A = "a".repeat(40);
const ROUTE_B = "b".repeat(40);
const post = (routeKey: string) =>
  app.request(`/telegram_bot/${routeKey}`, {
    method: "POST",
    headers: { "x-forwarded-for": "149.154.167.1" },
    body: "{}",
  });

describe("channel ingress rate limit", () => {
  test("one bot's bucket fills without affecting another bot on the same IP", async () => {
    for (let n = 0; n < LIMIT; n++) {
      expect((await post(ROUTE_A)).status).toBe(200);
    }
    expect((await post(ROUTE_A)).status).toBe(429);
    expect((await post(ROUTE_B)).status).toBe(200);

    const keys = [...counts.keys()];
    expect(keys).toHaveLength(2);
    // The route secret never reaches the store.
    for (const key of keys) {
      expect(key).not.toContain(ROUTE_A);
      expect(key).not.toContain(ROUTE_B);
      expect(key.startsWith("channel-ingress:telegram_bot:")).toBe(true);
    }
  });
});
