import { describe, expect, test } from "bun:test";
import * as jose from "jose";
import {
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
