import { describe, expect, test } from "bun:test";
import { app } from "../../app.js";

const FLOW_COOKIE = "wateaminbox_google_flow";

function flowCookie(response: Response): string {
  const header = response.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${FLOW_COOKIE}=`));
  if (!header) throw new Error("flow cookie not set");
  return header;
}

describe("Google sign-in routes", () => {
  test("status reports the configured client", async () => {
    const response = await app.request("/api/auth/google/status");
    expect(await response.json()).toEqual({ enabled: true });
  });

  test("start redirects to Google with a scoped HttpOnly flow cookie", async () => {
    const response = await app.request(
      "/api/auth/google/start?redirect=%2Finvite%2Fabc",
    );
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin).toBe("https://accounts.google.com");
    expect(location.searchParams.get("redirect_uri")).toEndWith(
      "/api/auth/google/callback",
    );

    const cookie = flowCookie(response);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Path=/api/auth/google");
    expect(cookie).toContain("SameSite=Lax");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("callback without a flow cookie returns to login as expired", async () => {
    const response = await app.request(
      "/api/auth/google/callback?code=c&state=s",
    );
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("googleError")).toBe("expired");
    expect(response.headers.getSetCookie().join()).not.toContain(
      "wateaminbox_refresh=",
    );
  });

  test("callback with a mismatched state is refused before any exchange", async () => {
    const start = await app.request(
      "/api/auth/google/start?redirect=%2Finvite%2Fabc",
    );
    const cookie = flowCookie(start).split(";")[0];

    const response = await app.request(
      "/api/auth/google/callback?code=c&state=forged",
      { headers: { cookie } },
    );
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.searchParams.get("googleError")).toBe("invalid");
    // The original destination survives so the user can retry the invitation.
    expect(location.searchParams.get("redirect")).toBe("/invite/abc");
    expect(response.headers.getSetCookie().join()).not.toContain(
      "wateaminbox_refresh=",
    );
  });

  test("a user who cancels on Google is told so", async () => {
    const start = await app.request("/api/auth/google/start");
    const cookie = flowCookie(start).split(";")[0];
    const response = await app.request(
      "/api/auth/google/callback?error=access_denied",
      { headers: { cookie } },
    );
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.searchParams.get("googleError")).toBe("cancelled");
  });
});
