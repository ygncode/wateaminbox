import { describe, expect, test } from "bun:test";
import { type Env, env, validateProductionEnv } from "./env.js";

function productionEnv(overrides: Partial<Env> = {}): Env {
  return {
    ...env,
    NODE_ENV: "production",
    DATABASE_URL:
      "postgresql://postgres:strong-database-password@db.acme.internal:5432/inbox?sslmode=require",
    JWT_SECRET: "a-strong-jwt-signing-secret-with-entropy-123456789",
    MAIL_DRIVER: "resend",
    RESEND_API_KEY: "re_live_acme_123456789",
    EMAIL_FROM: "WATeamInbox <noreply@acme.test>",
    APP_URL: "https://inbox.acme.test",
    CORS_ORIGINS: "https://inbox.acme.test,https://admin.acme.test",
    CENTRIFUGO_API_URL: "https://realtime.acme.test/api",
    CENTRIFUGO_HEALTH_URL: "https://realtime.acme.test/health",
    CENTRIFUGO_API_KEY: "centrifugo-live-api-key-123",
    CENTRIFUGO_TOKEN_HMAC_SECRET:
      "a-distinct-centrifugo-signing-secret-with-entropy-987654321",
    NATS_URL: "tls://connect.ngs.global:4222",
    S3_ENDPOINT: "https://account.r2.cloudflarestorage.com",
    S3_ACCESS_KEY: "R2LIVEACCESSKEY123",
    S3_SECRET_KEY: "r2-live-secret-key-456",
    S3_BUCKET: "inbox-media",
    MEILISEARCH_URL: "https://search.acme.test",
    MEILISEARCH_API_KEY: "meili-live-key-123",
    RATE_LIMIT_ENABLED: true,
    RATE_LIMIT_STORE_TYPE: "memory",
    RATE_LIMIT_REDIS_URL: "",
    TRUSTED_PROXY_IPS: "",
    TRUSTED_PROXY_IP_HEADER: "x-forwarded-for",
    ...overrides,
  };
}

function expectInvalid(overrides: Partial<Env>, message: RegExp): void {
  expect(() => validateProductionEnv(productionEnv(overrides))).toThrow(
    message,
  );
}

describe("production environment validation", () => {
  test("accepts managed services and a single-instance memory rate limiter", () => {
    expect(() => validateProductionEnv(productionEnv())).not.toThrow();
  });

  test("accepts managed Redis, workload identity, and exact trusted proxy IPs", () => {
    expect(() =>
      validateProductionEnv(
        productionEnv({
          S3_ACCESS_KEY: "",
          S3_SECRET_KEY: "",
          RATE_LIMIT_STORE_TYPE: "redis",
          RATE_LIMIT_REDIS_URL:
            "rediss://default:strong-redis-password@cache.acme.test:6380/0",
          TRUSTED_PROXY_IPS: "10.0.0.10,2001:db8::10",
          TRUSTED_PROXY_IP_HEADER: "cf-connecting-ip",
        }),
      ),
    ).not.toThrow();
  });

  test.each([
    "DATABASE_URL",
    "NATS_URL",
    "S3_ENDPOINT",
    "S3_BUCKET",
    "MEILISEARCH_URL",
    "MEILISEARCH_API_KEY",
    "RESEND_API_KEY",
    "EMAIL_FROM",
    "JWT_SECRET",
    "CENTRIFUGO_API_KEY",
    "CORS_ORIGINS",
  ] as const)("requires production setting %s", (key) => {
    expectInvalid(
      { [key]: "" },
      /Missing required production environment variables/,
    );
  });

  test.each([
    ["DATABASE_URL", "postgresql://postgres:strong@localhost:5432/inbox"],
    ["NATS_URL", "nats://127.0.0.1:4222"],
    ["S3_ENDPOINT", "http://localhost:4450"],
    ["MEILISEARCH_URL", "http://[::1]:7700"],
    ["CENTRIFUGO_API_URL", "http://localhost:4451/api"],
    ["CENTRIFUGO_HEALTH_URL", "http://localhost:4451/health"],
  ] as const)("rejects local production service URL %s", (key, value) => {
    expectInvalid({ [key]: value }, /local development host/);
  });

  test("rejects development database and NATS credentials", () => {
    expectInvalid(
      { DATABASE_URL: "postgresql://postgres:postgres@db.acme.test/inbox" },
      /development database credentials/,
    );
    expectInvalid(
      { NATS_URL: "nats://nats:password@nats.acme.test:4222" },
      /development NATS credentials/,
    );
  });

  test("rejects an incomplete S3 credential pair", () => {
    expectInvalid(
      { S3_ACCESS_KEY: "", S3_SECRET_KEY: "configured-secret" },
      /must either both be set or both be omitted/,
    );
  });

  test.each([
    ["S3_ACCESS_KEY", "minioadmin"],
    ["S3_SECRET_KEY", "minioadmin"],
    ["MEILISEARCH_API_KEY", "development_master_key"],
    ["CENTRIFUGO_API_KEY", "development-centrifugo-api-key"],
  ] as const)("rejects placeholder credential %s", (key, value) => {
    expectInvalid({ [key]: value }, /development or placeholder value/);
  });

  test("rejects non-delivering or placeholder mail configuration", () => {
    expectInvalid({ MAIL_DRIVER: "log" }, /must be resend/);
    expectInvalid({ RESEND_API_KEY: "re_xxxxxxxxxxxxx" }, /placeholder value/);
    expectInvalid({ EMAIL_FROM: "not-an-email" }, /valid email address/);
    expectInvalid(
      { EMAIL_FROM: "WATeamInbox <noreply@example.com>" },
      /reserved example domain/,
    );
  });

  test("rejects weak, placeholder, or reused signing secrets", () => {
    expectInvalid({ JWT_SECRET: "short" }, /at least 32 characters/);
    expectInvalid(
      { JWT_SECRET: "replace-with-at-least-32-random-characters" },
      /placeholder value/,
    );
    expectInvalid(
      {
        CENTRIFUGO_TOKEN_HMAC_SECRET:
          "development-centrifugo-token-secret-change-me",
      },
      /placeholder value/,
    );
    const shared = "strong-but-reused-signing-secret-123456789";
    expectInvalid(
      { JWT_SECRET: shared, CENTRIFUGO_TOKEN_HMAC_SECRET: shared },
      /must be different/,
    );
  });

  test("rejects unsafe CORS origins", () => {
    expectInvalid({ CORS_ORIGINS: "*" }, /wildcard or null/);
    expectInvalid(
      { CORS_ORIGINS: "http://localhost:4444" },
      /local development host/,
    );
    expectInvalid({ CORS_ORIGINS: "http://inbox.acme.test" }, /must use HTTPS/);
    expectInvalid(
      { CORS_ORIGINS: "https://inbox.acme.test/path" },
      /without paths or credentials/,
    );
    expectInvalid({ APP_URL: "http://inbox.acme.test" }, /must use HTTPS/);
  });

  test("rejects broad or ineffective trusted proxy settings", () => {
    expectInvalid(
      { TRUSTED_PROXY_IPS: "0.0.0.0/0" },
      /only exact proxy IP addresses/,
    );
    expectInvalid({ TRUSTED_PROXY_IPS: "*" }, /only exact proxy IP addresses/);
    expectInvalid(
      {
        TRUSTED_PROXY_IPS: "10.0.0.10",
        TRUSTED_PROXY_IP_HEADER: "authorization",
      },
      /supported client IP header/,
    );
  });

  test("requires effective production rate limiting", () => {
    expectInvalid({ RATE_LIMIT_ENABLED: false }, /must be true/);
    expectInvalid(
      { RATE_LIMIT_STORE_TYPE: "invalid" },
      /must be one of: memory, redis/,
    );
    expectInvalid(
      { RATE_LIMIT_STORE_TYPE: "redis", RATE_LIMIT_REDIS_URL: "" },
      /RATE_LIMIT_REDIS_URL is required/,
    );
    expectInvalid(
      {
        RATE_LIMIT_STORE_TYPE: "redis",
        RATE_LIMIT_REDIS_URL: "redis://localhost:6379",
      },
      /local development host/,
    );
    expectInvalid(
      {
        RATE_LIMIT_STORE_TYPE: "redis",
        RATE_LIMIT_REDIS_URL: "redis://default:password@cache.acme.test:6379",
      },
      /development Redis credentials/,
    );
  });
});
