import { describe, expect, test } from "bun:test";
import {
  buildAuthUrl,
  getAuthRedirectFromState,
  getSafeAuthRedirect,
} from "./auth-redirect";

describe("authentication redirects", () => {
  test("allows internal invitation paths and rejects external redirects", () => {
    expect(getSafeAuthRedirect("/invite/token")).toBe("/invite/token");
    expect(getSafeAuthRedirect("https://evil.example/path")).toBeNull();
    expect(getSafeAuthRedirect("//evil.example/path")).toBeNull();
  });

  test("preserves router location state", () => {
    expect(
      getAuthRedirectFromState({
        from: { pathname: "/invite/token", search: "?source=email" },
      }),
    ).toBe("/invite/token?source=email");
  });

  test("builds login and registration links with invitation context", () => {
    expect(
      buildAuthUrl("/register", "/invite/token", "person@example.com"),
    ).toBe("/register?redirect=%2Finvite%2Ftoken&email=person%40example.com");
  });
});
