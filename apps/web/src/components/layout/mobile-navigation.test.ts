import { describe, expect, it } from "bun:test";
import {
  buildMobileNavLinks,
  resolveActiveMobileNavKey,
} from "./mobile-navigation";

const WORKSPACE = "11111111-2222-3333-4444-555555555555";
const ALL: Parameters<typeof buildMobileNavLinks>[1] = {
  canViewDashboard: true,
  canSendBroadcasts: true,
};

describe("buildMobileNavLinks", () => {
  it("orders the bar as chat, groups, dashboard, broadcast", () => {
    expect(buildMobileNavLinks(WORKSPACE, ALL).map((link) => link.key)).toEqual(
      ["chat", "groups", "dashboard", "broadcasts"],
    );
  });

  it("separates the two conversation filters by the view query param", () => {
    const [chat, groups] = buildMobileNavLinks(WORKSPACE, ALL);
    expect(chat.path).toBe(`/w/${WORKSPACE}/chat`);
    expect(groups.path).toBe(`/w/${WORKSPACE}/chat?view=groups`);
  });

  it("encodes the workspace id into every destination", () => {
    const links = buildMobileNavLinks("a/b", ALL);
    expect(links.every((link) => link.path.startsWith("/w/a%2Fb/"))).toBe(true);
  });

  it("omits destinations the member cannot open", () => {
    expect(
      buildMobileNavLinks(WORKSPACE, {
        canViewDashboard: false,
        canSendBroadcasts: false,
      }).map((link) => link.key),
    ).toEqual(["chat", "groups"]);
  });

  it("keeps conversations reachable for the most restricted member", () => {
    const links = buildMobileNavLinks(WORKSPACE, {
      canViewDashboard: false,
      canSendBroadcasts: true,
    });
    expect(links.map((link) => link.key)).toEqual([
      "chat",
      "groups",
      "broadcasts",
    ]);
  });
});

describe("resolveActiveMobileNavKey", () => {
  it("distinguishes chat from groups on a shared pathname", () => {
    expect(resolveActiveMobileNavKey(`/w/${WORKSPACE}/chat`, "")).toBe("chat");
    expect(
      resolveActiveMobileNavKey(`/w/${WORKSPACE}/chat`, "?view=groups"),
    ).toBe("groups");
  });

  it("keeps the filter highlighted while a conversation is open", () => {
    expect(
      resolveActiveMobileNavKey(
        `/w/${WORKSPACE}/chat/contact-1`,
        "?view=groups",
      ),
    ).toBe("groups");
  });

  it("treats an unknown view value as all chats", () => {
    expect(
      resolveActiveMobileNavKey(`/w/${WORKSPACE}/chat`, "?view=archived"),
    ).toBe("chat");
  });

  it("highlights the standalone destinations", () => {
    expect(resolveActiveMobileNavKey(`/w/${WORKSPACE}/dashboard`, "")).toBe(
      "dashboard",
    );
    expect(resolveActiveMobileNavKey(`/w/${WORKSPACE}/broadcasts`, "")).toBe(
      "broadcasts",
    );
  });

  it("highlights profile for everything the account sheet owns", () => {
    for (const destination of ["team", "audit", "settings", "notifications"]) {
      expect(
        resolveActiveMobileNavKey(`/w/${WORKSPACE}/${destination}`, ""),
      ).toBe("profile");
    }
  });

  it("still resolves the legacy non-workspace paths", () => {
    expect(resolveActiveMobileNavKey("/chat", "?view=groups")).toBe("groups");
    expect(resolveActiveMobileNavKey("/dashboard", "")).toBe("dashboard");
  });
});
