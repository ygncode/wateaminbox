import { describe, expect, test } from "bun:test";
import {
  API_TOKEN_PREFIX,
  generateApiToken,
  hashApiToken,
} from "./api-token.service.js";

describe("generateApiToken", () => {
  test("produces a wti_-prefixed token with matching hash and prefix", () => {
    const { token, hash, prefix } = generateApiToken();
    expect(token.startsWith(API_TOKEN_PREFIX)).toBe(true);
    expect(token.length).toBe(44); // "wti_" + 40 random chars
    expect(hash).toBe(hashApiToken(token));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(token.startsWith(prefix)).toBe(true);
    expect(prefix.length).toBe(10);
  });

  test("tokens are unique", () => {
    const seen = new Set(
      Array.from({ length: 100 }, () => generateApiToken().token),
    );
    expect(seen.size).toBe(100);
  });

  test("hash is deterministic and secret-sensitive", () => {
    expect(hashApiToken("wti_abc")).toBe(hashApiToken("wti_abc"));
    expect(hashApiToken("wti_abc")).not.toBe(hashApiToken("wti_abd"));
  });
});
