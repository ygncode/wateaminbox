import { describe, expect, test } from "bun:test";
import { ApiRequestError } from "./api/client";
import { isEmailVerificationRequiredError } from "./email-verification";

describe("email verification login errors", () => {
  test("recognizes only the stable unverified-account error code", () => {
    expect(
      isEmailVerificationRequiredError(
        new ApiRequestError(
          403,
          "EMAIL_NOT_VERIFIED",
          "Verify your email address before signing in",
        ),
      ),
    ).toBe(true);

    expect(
      isEmailVerificationRequiredError(
        new ApiRequestError(403, "FORBIDDEN", "Forbidden"),
      ),
    ).toBe(false);
    expect(isEmailVerificationRequiredError(new Error("same message"))).toBe(
      false,
    );
  });
});
