import { describe, expect, test } from "bun:test";
import { assertEmailVerified } from "./auth.service.js";

describe("email verification login policy", () => {
  test("accepts a verified account", () => {
    expect(() => assertEmailVerified(new Date())).not.toThrow();
  });

  test("blocks an unverified account with a stable API error", () => {
    expect(() => assertEmailVerified(null)).toThrow(
      expect.objectContaining({
        code: "EMAIL_NOT_VERIFIED",
        statusCode: 403,
      }),
    );
  });
});
