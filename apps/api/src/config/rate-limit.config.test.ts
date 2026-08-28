import { describe, expect, test } from "bun:test";
import {
  DEFAULT_RATE_LIMIT_CONFIG,
  getRateLimitConfig,
  isValidRateLimitConfig,
  MAX_RATE_LIMIT_REQUESTS,
} from "./rate-limit.config.js";

describe("rate-limit configuration bounds", () => {
  test("accepts PostgreSQL and rejects an overflow-prone request limit", () => {
    const postgres = structuredClone(DEFAULT_RATE_LIMIT_CONFIG);
    postgres.store.type = "postgres";
    expect(isValidRateLimitConfig(postgres)).toBe(true);

    postgres.tiers.global.requests = MAX_RATE_LIMIT_REQUESTS + 1;
    expect(isValidRateLimitConfig(postgres)).toBe(false);
  });

  test("does not partially parse or accept unsafe environment integers", () => {
    const previous = process.env.RATE_LIMIT_GLOBAL_REQUESTS;
    try {
      process.env.RATE_LIMIT_GLOBAL_REQUESTS = "12requests";
      expect(getRateLimitConfig().tiers.global.requests).toBe(100);

      process.env.RATE_LIMIT_GLOBAL_REQUESTS = String(Number.MAX_SAFE_INTEGER);
      expect(getRateLimitConfig().tiers.global.requests).toBe(100);
    } finally {
      if (previous === undefined) {
        delete process.env.RATE_LIMIT_GLOBAL_REQUESTS;
      } else {
        process.env.RATE_LIMIT_GLOBAL_REQUESTS = previous;
      }
    }
  });
});
