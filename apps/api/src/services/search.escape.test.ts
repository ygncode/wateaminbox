import { describe, expect, test } from "bun:test";
import { escapeLikePattern } from "./search.service.js";

describe("escapeLikePattern", () => {
  test("escapes LIKE metacharacters and the escape character itself", () => {
    expect(escapeLikePattern("100%")).toBe("100\\%");
    expect(escapeLikePattern("a_b")).toBe("a\\_b");
    expect(escapeLikePattern("back\\slash")).toBe("back\\\\slash");
  });
  test("leaves non-Latin text untouched", () => {
    expect(escapeLikePattern("နေကောင်းလား")).toBe("နေကောင်းလား");
  });
});
