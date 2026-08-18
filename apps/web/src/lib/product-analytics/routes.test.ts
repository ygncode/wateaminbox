import { describe, expect, it } from "bun:test";
import {
  buildPageLocation,
  canonicalizeRoute,
  createNavigationDeduper,
  shouldTrackPageView,
} from "./routes";

const WORKSPACE_ID = "8f6f27a1-4a2e-4a52-9f2c-0b1d2e3f4a5b";
const CONTACT_ID = "abc123def456";
const JOB_ID = "job-77f0c2";

describe("route canonicalization", () => {
  it("maps every declared route to its expected template", () => {
    const cases: Array<[string, string]> = [
      ["/", "/"],
      ["/login", "/login"],
      ["/register", "/register"],
      ["/forgot-password", "/forgot-password"],
      ["/reset-password", "/reset-password"],
      ["/verify-email", "/verify-email"],
      ["/company-setup", "/company-setup"],
      ["/workspaces", "/workspaces"],
      ["/invite/secret-invitation-token", "/invite/:token"],
      [`/w/${WORKSPACE_ID}`, "/w/:workspace"],
      [`/w/${WORKSPACE_ID}/chat`, "/w/:workspace/chat"],
      [`/w/${WORKSPACE_ID}/chat/${CONTACT_ID}`, "/w/:workspace/chat/:contact"],
      [`/w/${WORKSPACE_ID}/team`, "/w/:workspace/team"],
      [`/w/${WORKSPACE_ID}/settings`, "/w/:workspace/settings"],
      [
        `/w/${WORKSPACE_ID}/settings/connections`,
        "/w/:workspace/settings/connections",
      ],
      [
        `/w/${WORKSPACE_ID}/settings/quick-replies`,
        "/w/:workspace/settings/quick-replies",
      ],
      [`/w/${WORKSPACE_ID}/settings/privacy`, "/w/:workspace/settings/privacy"],
      [`/w/${WORKSPACE_ID}/audit`, "/w/:workspace/audit"],
      [`/w/${WORKSPACE_ID}/dashboard`, "/w/:workspace/dashboard"],
      [`/w/${WORKSPACE_ID}/broadcasts`, "/w/:workspace/broadcasts"],
      [
        `/w/${WORKSPACE_ID}/broadcasts/${JOB_ID}`,
        "/w/:workspace/broadcasts/:job",
      ],
      [`/w/${WORKSPACE_ID}/notifications`, "/w/:workspace/notifications"],
      ["/chat", "/chat"],
      [`/chat/${CONTACT_ID}`, "/chat/:contact"],
      ["/settings", "/settings"],
      ["/settings/general", "/settings/general"],
      ["/dashboard", "/dashboard"],
      ["/broadcasts", "/broadcasts"],
      ["/team", "/team"],
      ["/audit", "/audit"],
      ["/notifications", "/notifications"],
    ];
    for (const [input, expected] of cases) {
      expect(canonicalizeRoute(input).path).toBe(expected);
    }
  });

  it("never carries workspace, contact, job, or invitation identifiers", () => {
    const sensitive = [
      `/w/${WORKSPACE_ID}/chat/${CONTACT_ID}`,
      `/w/${WORKSPACE_ID}/broadcasts/${JOB_ID}`,
      "/invite/super-secret-invitation-token",
      `/chat/${CONTACT_ID}`,
    ];
    for (const input of sensitive) {
      const { path, title } = canonicalizeRoute(input);
      for (const secret of [WORKSPACE_ID, CONTACT_ID, JOB_ID, "secret"]) {
        expect(path).not.toContain(secret);
        expect(title).not.toContain(secret);
      }
    }
  });

  it("always removes query strings and hashes", () => {
    expect(canonicalizeRoute("/reset-password?token=secret-reset").path).toBe(
      "/reset-password",
    );
    expect(canonicalizeRoute("/verify-email?token=secret#frag").path).toBe(
      "/verify-email",
    );
    expect(canonicalizeRoute("/login#access_token=abc").path).toBe("/login");
    expect(
      canonicalizeRoute(`/w/${WORKSPACE_ID}/chat?companyId=${WORKSPACE_ID}`)
        .path,
    ).toBe("/w/:workspace/chat");
  });

  it("collapses unknown settings sections to a placeholder", () => {
    expect(
      canonicalizeRoute(`/w/${WORKSPACE_ID}/settings/secret-section`).path,
    ).toBe("/w/:workspace/settings/:section");
    expect(canonicalizeRoute("/settings/secret-section").path).toBe(
      "/settings/:section",
    );
  });

  it("maps unknown paths to the fixed /unknown value", () => {
    const unknowns = [
      "/definitely-not-a-route",
      "/admin/secret",
      `/w/${WORKSPACE_ID}/exports/${JOB_ID}`,
      `/w/${WORKSPACE_ID}/chat/${CONTACT_ID}/extra`,
      "/invite/a/b",
      "/team/extra",
    ];
    for (const input of unknowns) {
      expect(canonicalizeRoute(input)).toEqual({
        path: "/unknown",
        title: "Unknown",
      });
    }
  });

  it("uses static titles, never document.title", () => {
    expect(canonicalizeRoute("/login").title).toBe("Login");
    expect(canonicalizeRoute(`/w/${WORKSPACE_ID}/chat`).title).toBe("Chat");
    expect(canonicalizeRoute(`/w/${WORKSPACE_ID}/dashboard`).title).toBe(
      "Dashboard",
    );
  });
});

describe("page view tracker decision", () => {
  it("tracks settled rendered destinations", () => {
    const settled = [
      "/login",
      "/register",
      "/forgot-password",
      "/reset-password?token=secret",
      "/verify-email",
      "/company-setup",
      "/workspaces",
      "/invite/secret-token",
      `/w/${WORKSPACE_ID}/chat`,
      `/w/${WORKSPACE_ID}/chat/${CONTACT_ID}`,
      `/w/${WORKSPACE_ID}/team`,
      `/w/${WORKSPACE_ID}/settings/general`,
      `/w/${WORKSPACE_ID}/settings/privacy`,
      `/w/${WORKSPACE_ID}/audit`,
      `/w/${WORKSPACE_ID}/dashboard`,
      `/w/${WORKSPACE_ID}/broadcasts`,
      `/w/${WORKSPACE_ID}/broadcasts/${JOB_ID}`,
      `/w/${WORKSPACE_ID}/notifications`,
    ];
    for (const pathname of settled) {
      expect(shouldTrackPageView(pathname)).toBe(true);
    }
  });

  it("skips redirect-only locations so one navigation counts once", () => {
    const redirectOnly = [
      "/", // -> /chat
      "/definitely-not-a-route", // wildcard -> /chat
      `/w/${WORKSPACE_ID}`, // workspace index -> chat
      `/w/${WORKSPACE_ID}/settings`, // -> settings/general
      `/w/${WORKSPACE_ID}/settings/secret-section`, // -> settings/general
      "/chat", // legacy -> /w/:workspace/chat
      `/chat/${CONTACT_ID}`,
      "/settings",
      "/settings/general",
      "/dashboard",
      "/broadcasts",
      "/team",
      "/audit",
      "/notifications",
    ];
    for (const pathname of redirectOnly) {
      expect(shouldTrackPageView(pathname)).toBe(false);
    }
  });
});

describe("page location", () => {
  it("combines the deployment origin with the canonical path only", () => {
    expect(
      buildPageLocation("https://inbox.example.com", "/w/:workspace/chat"),
    ).toBe("https://inbox.example.com/w/:workspace/chat");
  });
});

describe("navigation deduper", () => {
  it("tracks one page view per navigation under StrictMode double effects", () => {
    const shouldTrack = createNavigationDeduper();
    expect(shouldTrack("default")).toBe(true);
    // StrictMode re-runs the same effect with the same navigation key.
    expect(shouldTrack("default")).toBe(false);
    expect(shouldTrack("nav-1")).toBe(true);
    expect(shouldTrack("nav-1")).toBe(false);
    // Revisiting the same route later is a new navigation (new key).
    expect(shouldTrack("nav-2")).toBe(true);
  });
});
