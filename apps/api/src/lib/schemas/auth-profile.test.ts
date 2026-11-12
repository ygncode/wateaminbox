import { describe, expect, test } from "bun:test";
import { changePasswordSchema, updateProfileSchema } from "./auth";

describe("account settings validation", () => {
  test("normalizes an updated email", () => {
    const parsed = updateProfileSchema.parse({
      email: "  Maya@Example.com ",
      currentPassword: "current-password",
    });
    expect(parsed.email).toBe("maya@example.com");
  });

  test("accepts removal of a custom profile image", () => {
    expect(updateProfileSchema.parse({ avatarDataUrl: null })).toEqual({
      avatarDataUrl: null,
    });
  });

  test("rejects unsupported profile image data", () => {
    expect(
      updateProfileSchema.safeParse({
        avatarDataUrl: "data:image/svg+xml;base64,PHN2Zz4=",
      }).success,
    ).toBe(false);
  });

  test("accepts a supported interface language on its own", () => {
    expect(updateProfileSchema.parse({ preferredLanguage: "zh-CN" })).toEqual({
      preferredLanguage: "zh-CN",
    });
    expect(updateProfileSchema.parse({ preferredLanguage: "ar" })).toEqual({
      preferredLanguage: "ar",
    });
  });

  test("lets a user clear their language choice", () => {
    expect(updateProfileSchema.parse({ preferredLanguage: null })).toEqual({
      preferredLanguage: null,
    });
  });

  test("rejects an unsupported or malformed language", () => {
    for (const preferredLanguage of ["xx", "zh-cn", "en-US", "", "<script>"]) {
      expect(
        updateProfileSchema.safeParse({ preferredLanguage }).success,
      ).toBe(false);
    }
  });

  test("requires a different new password", () => {
    expect(
      changePasswordSchema.safeParse({
        currentPassword: "SamePassword1",
        newPassword: "SamePassword1",
      }).success,
    ).toBe(false);
  });
});
