import { describe, expect, test } from "bun:test";
import { app } from "../src/app";
import { getRuntimeConfig, hasExactOrigin } from "../src/lib/config";
import type { Env } from "../src/types";

function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    ADMIN_PASSWORD_HASH: "test-password-hash",
    ADMIN_SESSION_SECRET:
      "test-admin-secret-that-is-longer-than-thirty-two-characters",
    ALLOWED_ORIGINS: "https://marketing.example.test",
    DB: {} as Env["DB"],
    EMAIL: {} as Env["EMAIL"],
    ENVIRONMENT: "production",
    MARKETING_ORIGIN: "https://marketing.example.test",
    PUBLIC_API_ORIGIN: "https://waitlist-api.example.test",
    TURNSTILE_SECRET_KEY: "test-turnstile-secret",
    WAITLIST_FROM_EMAIL: "WATeamInbox <waitlist@example.test>",
    WAITLIST_TOKEN_SECRET:
      "test-waitlist-secret-that-is-longer-than-thirty-two-characters",
    ...overrides,
  };
}

describe("waitlist origin hardening", () => {
  test("permits HTTP origins only in local development", () => {
    const config = getRuntimeConfig(
      testEnv({
        ALLOWED_ORIGINS: "http://localhost:4446",
        ENVIRONMENT: "development",
        MARKETING_ORIGIN: "http://localhost:4446",
        PUBLIC_API_ORIGIN: "http://localhost:8787",
        TURNSTILE_SECRET_KEY: "",
      }),
    );

    expect(config.marketingOrigin).toBe("http://localhost:4446");
    expect(config.apiOrigin).toBe("http://localhost:8787");
    expect(config.secureCookies).toBe(false);
  });

  test("requires HTTPS for every configured origin outside development", () => {
    expect(() =>
      getRuntimeConfig(
        testEnv({ MARKETING_ORIGIN: "http://marketing.example.test" }),
      ),
    ).toThrow("MARKETING_ORIGIN must use HTTPS outside local development");

    expect(() =>
      getRuntimeConfig(
        testEnv({ PUBLIC_API_ORIGIN: "http://waitlist-api.example.test" }),
      ),
    ).toThrow("PUBLIC_API_ORIGIN must use HTTPS outside local development");

    expect(() =>
      getRuntimeConfig(
        testEnv({
          ALLOWED_ORIGINS:
            "https://marketing.example.test,http://preview.example.test",
        }),
      ),
    ).toThrow("ALLOWED_ORIGINS must use HTTPS outside local development");

    expect(() =>
      getRuntimeConfig(
        testEnv({
          ENVIRONMENT: "staging",
          PUBLIC_API_ORIGIN: "http://waitlist-api.example.test",
        }),
      ),
    ).toThrow("PUBLIC_API_ORIGIN must use HTTPS outside local development");
  });

  test("uses secure cookies when a non-development configuration is valid", () => {
    expect(getRuntimeConfig(testEnv()).secureCookies).toBe(true);
  });

  test("disables workers.dev and preview URLs in the checked-in Worker config", async () => {
    const config = JSON.parse(
      await Bun.file(new URL("../wrangler.jsonc", import.meta.url)).text(),
    ) as Record<string, unknown>;

    expect(config.workers_dev).toBe(false);
    expect(config.preview_urls).toBe(false);
  });

  test("requires an exact Origin header for admin mutations", async () => {
    const env = testEnv({
      ALLOWED_ORIGINS: "http://localhost:4446",
      ENVIRONMENT: "development",
      MARKETING_ORIGIN: "http://localhost:4446",
      PUBLIC_API_ORIGIN: "http://localhost:8787",
      TURNSTILE_SECRET_KEY: "",
    });

    for (const [path, error] of [
      ["/admin/login", "Invalid sign-in origin."],
      ["/admin/logout", "Invalid sign-out origin."],
    ]) {
      for (const origin of [undefined, "https://untrusted.example"]) {
        const response = await app.request(
          `http://localhost:8787${path}`,
          {
            body: "csrf=not-used",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              ...(origin ? { Origin: origin } : {}),
            },
            method: "POST",
          },
          env,
        );

        expect(response.status).toBe(403);
        expect(((await response.json()) as { error: string }).error).toBe(
          error,
        );
      }
    }
  });

  test("accepts only the exact serialized admin origin", () => {
    const expected = "https://waitlist-api.example.test";

    expect(
      hasExactOrigin(
        new Request(`${expected}/admin/login`, {
          headers: { Origin: expected },
          method: "POST",
        }),
        expected,
      ),
    ).toBe(true);
    expect(
      hasExactOrigin(
        new Request(`${expected}/admin/login`, { method: "POST" }),
        expected,
      ),
    ).toBe(false);
    expect(
      hasExactOrigin(
        new Request(`${expected}/admin/login`, {
          headers: { Origin: `${expected}/` },
          method: "POST",
        }),
        expected,
      ),
    ).toBe(false);
  });
});
