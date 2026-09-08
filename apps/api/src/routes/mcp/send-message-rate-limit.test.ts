import { beforeEach, describe, expect, test } from "bun:test";
import type { Context } from "hono";
import { Hono } from "hono";
import { rateLimitConfig, rateLimitStore } from "../../lib/rate-limit-store.js";
import { createRateLimitMiddleware } from "../../middleware/rate-limit.js";
import { writeTools } from "./tools/write.js";

/**
 * Regression coverage for the MCP send path sharing the per-user
 * `messaging-send:user:<userId>` bucket with REST `POST /messages`.
 *
 * `send_message` and `start_conversation` both queue through `queueTextMessage`,
 * which now calls `enforceSendRateLimit` before any database work. These tests
 * drive the tool handler directly with a stub context whose `tenantDb` throws
 * on any access: if the limiter rejects the call must never reach the tenant
 * database, and if the limiter allows it the thrown error proves it got past.
 *
 * The default test environment leaves `RATE_LIMIT_ENABLED` true and the store
 * type as `memory`, so the real `rateLimitStore` singleton (a fresh
 * `MemoryRateLimitStore` per process) is exercised without any mocking.
 */

const sendMessage = writeTools.find((t) => t.name === "send_message");
if (!sendMessage) throw new Error("send_message tool not found");

const tier = rateLimitConfig.tiers.messaging.send;
const keyFor = (userId: string) => `messaging-send:user:${userId}`;

function fakeContext(values: Record<string, unknown>): Context {
  return {
    get: (key: string) => values[key],
    req: { header: () => undefined },
  } as unknown as Context;
}

/** A tenantDb that throws on any property access, so a call that reaches it
 * fails loudly instead of silently doing real database work. */
function explosiveTenantDb(): unknown {
  return new Proxy(
    {},
    {
      get() {
        throw new Error("tenantDb should not be touched");
      },
    },
  );
}

function userContext(userId: string): Context {
  return fakeContext({
    tenantDb: explosiveTenantDb(),
    companyId: "company-1",
    user: { id: userId, email: `${userId}@example.com`, name: "Tester" },
    companyPermissions: { can_send_messages: true, can_view_all_chats: true },
    companyRole: "owner",
    apiToken: { id: "token-1" },
  });
}

/** A Hono app whose only middleware is the REST `POST /messages` limiter,
 * configured identically to `routes/messages/send.ts` so REST and MCP can be
 * shown to spend one shared per-user budget. */
function restSendApp(userId: string): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user", {
      id: userId,
      email: `${userId}@example.com`,
      name: null,
      emailVerifiedAt: null,
    });
    await next();
  });
  app.use(
    "*",
    createRateLimitMiddleware({
      store: rateLimitStore,
      tier,
      keyStrategy: "user",
      keyPrefix: "messaging-send",
    }),
  );
  app.post("/messages", (c) => c.json({ ok: true }));
  return app;
}

async function exhaust(key: string): Promise<void> {
  for (let i = 0; i < tier.requests; i++) {
    const result = await rateLimitStore.increment(
      key,
      tier.requests,
      tier.windowSeconds,
    );
    expect(result.allowed).toBe(true);
  }
}

describe("send_message per-user send rate limit", () => {
  beforeEach(async () => {
    await rateLimitStore.clear();
  });

  test("rejects once the messaging-send:user:<id> bucket is full, before any DB work", async () => {
    const userId = crypto.randomUUID();
    await exhaust(keyFor(userId));

    // The next increment (the tool's own) must be denied, and the handler
    // must reject before touching the tenant database.
    await expect(
      sendMessage.handler(
        { contactId: crypto.randomUUID(), content: "hi" },
        userContext(userId),
      ),
    ).rejects.toThrow("Send rate limit exceeded");
  });

  test("does not reject prematurely when the bucket still has capacity", async () => {
    const userId = crypto.randomUUID();
    // One prior send leaves plenty of room; the next send must get past the
    // limiter and reach the tenant database (here the exploding stub).
    await rateLimitStore.increment(
      keyFor(userId),
      tier.requests,
      tier.windowSeconds,
    );
    await expect(
      sendMessage.handler(
        { contactId: crypto.randomUUID(), content: "hi" },
        userContext(userId),
      ),
    ).rejects.toThrow("tenantDb should not be touched");
  });

  test("REST POST /messages and MCP send_message share one per-user bucket", async () => {
    const userId = crypto.randomUUID();
    const app = restSendApp(userId);

    // Spend the entire per-user budget through the REST limiter.
    for (let i = 0; i < tier.requests; i++) {
      const res = await app.request("http://localhost/messages", {
        method: "POST",
      });
      expect(res.status).toBe(200);
    }

    // The very next increment on the shared key is MCP send_message's; REST
    // already spent the per-user budget, so MCP must be denied too.
    await expect(
      sendMessage.handler(
        { contactId: crypto.randomUUID(), content: "hi" },
        userContext(userId),
      ),
    ).rejects.toThrow("Send rate limit exceeded");
  });

  test("a different user's REST exhaustion does not block this MCP send", async () => {
    const restUser = crypto.randomUUID();
    const mcpUser = crypto.randomUUID();
    const app = restSendApp(restUser);
    for (let i = 0; i < tier.requests; i++) {
      await app.request("http://localhost/messages", { method: "POST" });
    }

    // restUser's bucket is full; mcpUser has a fresh bucket and must pass the
    // limiter (then reach the exploding stub), proving the key is per-user.
    await expect(
      sendMessage.handler(
        { contactId: crypto.randomUUID(), content: "hi" },
        userContext(mcpUser),
      ),
    ).rejects.toThrow("tenantDb should not be touched");
  });

  test("exhausting the bulk-jobs bucket does not block send_message", async () => {
    const userId = crypto.randomUUID();
    const bulkTier = rateLimitConfig.tiers.messaging.bulk;
    for (let i = 0; i < bulkTier.requests; i++) {
      const result = await rateLimitStore.increment(
        `bulk-jobs:user:${userId}`,
        bulkTier.requests,
        bulkTier.windowSeconds,
      );
      expect(result.allowed).toBe(true);
    }

    // The send limiter keys on `messaging-send`, not `bulk-jobs`, so this send
    // must pass the limiter and reach the exploding stub.
    await expect(
      sendMessage.handler(
        { contactId: crypto.randomUUID(), content: "hi" },
        userContext(userId),
      ),
    ).rejects.toThrow("tenantDb should not be touched");
  });

  test("exhausting the messaging-schedule bucket does not block send_message", async () => {
    const userId = crypto.randomUUID();
    await exhaust(`messaging-schedule:user:${userId}`);

    // `schedule_message` uses a `messaging-schedule` key; `send_message` uses
    // `messaging-send`, so the exhausted schedule bucket must not block it.
    await expect(
      sendMessage.handler(
        { contactId: crypto.randomUUID(), content: "hi" },
        userContext(userId),
      ),
    ).rejects.toThrow("tenantDb should not be touched");
  });
});
