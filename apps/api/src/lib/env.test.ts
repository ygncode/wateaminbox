import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  type Env,
  env,
  validateProductionEnv,
  validateSigningSecrets,
} from "./env.js";

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
    S3_BUCKET: "whatsapp-media",
    S3_REGION: "auto",
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
    ["S3_ENDPOINT", "https://localhost:4450"],
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

  test("rejects unsafe production object-storage signing configuration", () => {
    expectInvalid(
      { S3_ACCESS_KEY: "", S3_SECRET_KEY: "configured-secret" },
      /must either both be set or both be omitted/,
    );
    expectInvalid({ S3_ENDPOINT: "http://storage.acme.test" }, /https/i);
    expectInvalid(
      { S3_ENDPOINT: "https://account.r2.cloudflarestorage.com/path" },
      /path-free HTTPS R2 S3 API endpoint/,
    );
    for (const endpoint of [
      "https://pub.r2.dev",
      "https://media.acme.test",
      "https://account.r2.cloudflarestorage.com.evil.test",
    ]) {
      expectInvalid({ S3_ENDPOINT: endpoint }, /account R2 S3 endpoint/);
    }
    expectInvalid({ S3_REGION: "us-east-1" }, /must be auto/);
    expectInvalid(
      { S3_BUCKET: "replacement-media" },
      /must remain whatsapp-media/,
    );
    expectInvalid({ S3_FORCE_PATH_STYLE: false }, /must be true/);
    expectInvalid({ S3_SIGNED_URL_TTL_SECONDS: 901 }, /between 60 and 900/);
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

/**
 * HS256 accepts a zero-length key, so an empty signing secret is not a loud
 * failure - it silently makes every issued token forgeable. A process that
 * merely forgot to set NODE_ENV must therefore still refuse to start.
 */
describe("signing secrets are validated in every environment", () => {
  function nonProductionEnv(overrides: Partial<Env> = {}): Env {
    return {
      ...env,
      NODE_ENV: "development",
      JWT_SECRET: "an-explicitly-supplied-local-secret-123456789",
      CENTRIFUGO_TOKEN_HMAC_SECRET:
        "a-distinct-explicitly-supplied-local-secret-987654321",
      ...overrides,
    };
  }

  test("explicitly supplied local secrets start cleanly", () => {
    expect(() => validateSigningSecrets(nonProductionEnv())).not.toThrow();
  });

  test("the signing secrets ship with no built-in default", () => {
    // A published development key is not a safeguard: a server that forgot
    // NODE_ENV would run with a key anyone can read out of this repository.
    // The suite injects its own via bunfig.toml preload, so the only way this
    // can pass is if the value came from outside lib/env.ts.
    const source = readFileSync(
      new URL("./env.ts", import.meta.url).pathname,
      "utf8",
    );
    expect(source).toContain('getEnv("JWT_SECRET", "")');
    expect(source).toContain('getEnv("CENTRIFUGO_TOKEN_HMAC_SECRET", "")');
    expect(source).not.toMatch(/JWT_SECRET",\s*\n?\s*isProduction \?/);
  });

  test("the test process supplied its own secrets", () => {
    expect(env.JWT_SECRET.trim().length).toBeGreaterThan(0);
    expect(env.CENTRIFUGO_TOKEN_HMAC_SECRET.trim().length).toBeGreaterThan(0);
    expect(() => validateSigningSecrets()).not.toThrow();
  });

  test.each([
    "development",
    "test",
    "staging",
    "",
  ])("a missing JWT_SECRET fails closed when NODE_ENV is %p", (nodeEnv) => {
    expect(() =>
      validateSigningSecrets(
        nonProductionEnv({ NODE_ENV: nodeEnv, JWT_SECRET: "" }),
      ),
    ).toThrow(/JWT_SECRET is required and must not be blank/);
  });

  test("a whitespace-only JWT_SECRET is treated as missing", () => {
    expect(() =>
      validateSigningSecrets(nonProductionEnv({ JWT_SECRET: "   " })),
    ).toThrow(/JWT_SECRET is required and must not be blank/);
  });

  test("the failure names the variable and how to generate one", () => {
    // The whole point is that an operator hits this at startup and can fix it
    // without reading the source.
    expect(() =>
      validateSigningSecrets(nonProductionEnv({ JWT_SECRET: "" })),
    ).toThrow(/openssl rand/);
  });

  test("a missing Centrifugo signing secret also fails closed", () => {
    expect(() =>
      validateSigningSecrets(
        nonProductionEnv({ CENTRIFUGO_TOKEN_HMAC_SECRET: "" }),
      ),
    ).toThrow(/CENTRIFUGO_TOKEN_HMAC_SECRET is required and must not be blank/);
  });

  test("reusing one secret for both roles fails outside production too", () => {
    const shared = "a-single-secret-used-for-both-roles-123456789";
    expect(() =>
      validateSigningSecrets(
        nonProductionEnv({
          JWT_SECRET: shared,
          CENTRIFUGO_TOKEN_HMAC_SECRET: shared,
        }),
      ),
    ).toThrow(/must be different/);
  });

  test("two empty production secrets report as missing, not as identical", () => {
    // The required-variable check lists every missing name at once, which is
    // the more useful production failure.
    expect(() =>
      validateProductionEnv(
        productionEnv({ JWT_SECRET: "", CENTRIFUGO_TOKEN_HMAC_SECRET: "" }),
      ),
    ).toThrow(/Missing required production environment variables/);
  });

  test("production still rejects a reused secret", () => {
    const shared = "strong-but-reused-signing-secret-123456789";
    expectInvalid(
      { JWT_SECRET: shared, CENTRIFUGO_TOKEN_HMAC_SECRET: shared },
      /must be different/,
    );
  });
});
