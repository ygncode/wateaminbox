import { describe, expect, test } from "bun:test";
import { app, shouldSkipGlobalRateLimit } from "./app.js";

describe("global rate-limit routing", () => {
  test("leaves sensitive auth endpoints to their dedicated limiters", () => {
    expect(shouldSkipGlobalRateLimit("/api/auth/login")).toBe(true);
    expect(shouldSkipGlobalRateLimit("/api/auth/register")).toBe(true);
    expect(shouldSkipGlobalRateLimit("/api/auth/refresh")).toBe(true);
    expect(shouldSkipGlobalRateLimit("/api/contacts")).toBe(false);
  });

  test("leaves provider webhooks to their per-account limiter", () => {
    // Every Telegram bot is called from Telegram's addresses; an IP bucket
    // would let one flooded bot starve the others.
    expect(
      shouldSkipGlobalRateLimit("/api/channel-ingress/telegram_bot/abc"),
    ).toBe(true);
    expect(shouldSkipGlobalRateLimit("/api/channel-ingress-other")).toBe(false);
  });
});

describe("CORS", () => {
  test("allows the realtime client header for action requests", async () => {
    const response = await app.request("/api/actions/messages/typing", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:4444",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers":
          "authorization,content-type,x-company-id,x-realtime-client-id",
      },
    });

    expect(response.status).toBe(204);
    const allowedHeaders =
      response.headers.get("Access-Control-Allow-Headers")?.toLowerCase() ?? "";
    expect(allowedHeaders.split(",").map((header) => header.trim())).toContain(
      "x-realtime-client-id",
    );
  });
});
