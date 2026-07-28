import { describe, expect, test } from "bun:test";
import { getGravatarUrl } from "./gravatar";

describe("Gravatar profile fallback", () => {
  test("normalizes email casing and whitespace before hashing", () => {
    expect(getGravatarUrl("  MyEmailAddress@example.com ")).toBe(
      "https://www.gravatar.com/avatar/0bc83cb571cd1c50ba6f3e8a78ef1346?s=256&d=mp",
    );
  });
});
