import { describe, expect, test } from "bun:test";
import * as jose from "jose";
import {
  broadcastToUsers,
  createRealtimeConnectionToken,
  getRealtimeChannels,
  REALTIME_TOKEN_AUDIENCE,
  REALTIME_TOKEN_ISSUER,
} from "./realtime.js";

const companyId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const secret = "test-centrifugo-secret-at-least-32-characters";

describe("Centrifugo connection credentials", () => {
  test("scopes subscriptions to the authenticated company and user", () => {
    expect(getRealtimeChannels(companyId, userId)).toEqual([
      `company:${companyId}`,
      `user:${companyId}:${userId}`,
    ]);
  });

  test("signs a short-lived connection token with scoped subscriptions", async () => {
    const token = await createRealtimeConnectionToken(
      userId,
      companyId,
      secret,
    );
    const { payload, protectedHeader } = await jose.jwtVerify(
      token,
      new TextEncoder().encode(secret),
      {
        audience: REALTIME_TOKEN_AUDIENCE,
        issuer: REALTIME_TOKEN_ISSUER,
      },
    );

    expect(protectedHeader.alg).toBe("HS256");
    expect(payload.sub).toBe(userId);
    expect(payload.companyId).toBe(companyId);
    expect(payload.channels).toEqual(getRealtimeChannels(companyId, userId));
    expect(payload.exp).toBeGreaterThan(payload.iat ?? 0);
  });
});

/**
 * Every company member is subscribed to `company:{companyId}`, so anything
 * published there is readable by the whole workspace. Conversation-scoped
 * events must therefore travel on per-user channels only.
 */
describe("conversation events are delivered per authorized user", () => {
  const viewerA = "33333333-3333-4333-8333-333333333333";
  const viewerB = "44444444-4444-4444-8444-444444444444";

  interface PublishBody {
    channels?: string[];
    channel?: string;
    data: { type: string; data: Record<string, unknown> };
  }
  interface Capture {
    calls: Array<{ url: string; channels: string[]; body: PublishBody }>;
    restore: () => void;
  }

  function captureFetch(
    respond: () => Response = () =>
      new Response(JSON.stringify({ result: { responses: [{}] } }), {
        status: 200,
      }),
  ): Capture {
    const calls: Capture["calls"] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as PublishBody;
      calls.push({
        url: String(url),
        channels: body.channels ?? (body.channel ? [body.channel] : []),
        body,
      });
      return respond();
    }) as typeof fetch;
    return {
      calls,
      restore: () => {
        globalThis.fetch = originalFetch;
      },
    };
  }

  test("addresses one channel per recipient and never the company channel", async () => {
    const capture = captureFetch();
    try {
      await broadcastToUsers(
        companyId,
        [viewerA, viewerB],
        "message:new",
        { message: { content: "secret" } },
        { connectionId: "connection-1" },
      );
    } finally {
      capture.restore();
    }

    expect(capture.calls).toHaveLength(1);
    expect(capture.calls[0].channels.sort()).toEqual(
      [`user:${companyId}:${viewerA}`, `user:${companyId}:${viewerB}`].sort(),
    );
    expect(capture.calls[0].channels).not.toContain(`company:${companyId}`);
    expect(capture.calls[0].body.data.type).toBe("message:new");
    expect(capture.calls[0].body.data.data.connectionId).toBe("connection-1");
  });

  test("fan-out costs one API call regardless of audience size", async () => {
    // A per-channel loop would make every typing keystroke N round trips.
    const capture = captureFetch();
    const manyViewers = Array.from({ length: 25 }, (_, i) => `user-${i}`);
    try {
      await broadcastToUsers(companyId, manyViewers, "typing:start", {});
    } finally {
      capture.restore();
    }

    expect(capture.calls).toHaveLength(1);
    expect(capture.calls[0].url).toEndWith("/broadcast");
    expect(capture.calls[0].channels).toHaveLength(25);
  });

  test("an empty recipient set publishes nothing at all", async () => {
    // Verified against centrifugo v6.9.1: an empty `channels` array is
    // rejected with a top-level {"error":{"code":107,"message":"bad request"}},
    // so this must never reach the transport.
    const capture = captureFetch();
    try {
      await broadcastToUsers(companyId, [], "message:new", { message: {} });
      await broadcastToUsers(companyId, ["", ""], "message:new", {});
    } finally {
      capture.restore();
    }
    expect(capture.calls).toEqual([]);
  });

  test("a repeated recipient is collapsed to one channel", async () => {
    // A duplicated channel in the batch delivers the event twice, and clients
    // would apply it twice.
    const capture = captureFetch();
    try {
      await broadcastToUsers(
        companyId,
        [viewerA, viewerB, viewerA, viewerA],
        "message:reaction",
        {},
      );
    } finally {
      capture.restore();
    }
    expect(capture.calls).toHaveLength(1);
    expect(capture.calls[0].channels).toEqual([
      `user:${companyId}:${viewerA}`,
      `user:${companyId}:${viewerB}`,
    ]);
  });

  test("excludeClientId rides along so the originating tab can filter itself", async () => {
    const capture = captureFetch();
    try {
      await broadcastToUsers(
        companyId,
        [viewerA],
        "typing:start",
        {},
        {
          excludeClientId: "client-9",
        },
      );
    } finally {
      capture.restore();
    }
    expect(capture.calls[0].body.data.data.excludeClientId).toBe("client-9");
  });

  test("a transport failure is swallowed, not propagated to the caller", async () => {
    // The state change that produced the event is already committed; realtime
    // is an update signal clients reconcile against PostgreSQL.
    const capture = captureFetch(() => new Response("nope", { status: 500 }));
    try {
      await expect(
        broadcastToUsers(companyId, [viewerA, viewerB], "message:new", {
          message: {},
        }),
      ).resolves.toBeUndefined();
    } finally {
      capture.restore();
    }
    expect(capture.calls).toHaveLength(1);
  });

  test("a per-channel error inside the batch is not silently ignored", async () => {
    // Centrifugo reports these inside `responses`, not as a top-level error.
    const capture = captureFetch(
      () =>
        new Response(
          JSON.stringify({
            result: {
              responses: [
                {},
                { error: { code: 102, message: "unknown channel" } },
              ],
            },
          }),
          { status: 200 },
        ),
    );
    try {
      await expect(
        broadcastToUsers(companyId, [viewerA, viewerB], "message:new", {}),
      ).resolves.toBeUndefined();
    } finally {
      capture.restore();
    }
    expect(capture.calls).toHaveLength(1);
  });
});
