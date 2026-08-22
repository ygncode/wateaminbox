import { describe, expect, test } from "bun:test";
import type { MemberPermissions } from "@wateaminbox/shared";
import {
  chatViewPath,
  getWorkspaceDestination,
  parseChatView,
  resolveInitialWorkspaceId,
  resolveWorkspaceDestination,
  withChatView,
  workspacePath,
} from "./workspace-routes";

const permissions: MemberPermissions = {
  can_view_all_chats: true,
  can_send_messages: true,
  can_send_bulk_messages: false,
  can_assign_contacts: false,
  can_manage_team: false,
  can_invite: false,
  can_manage_connections: false,
  can_view_dashboard: true,
  can_view_audit: false,
  can_export: false,
  can_delete: false,
};

describe("workspace routes", () => {
  test("resolves initial workspace by URL, preference, migration, then singleton", () => {
    const ids = ["acme", "northwind"];
    expect(resolveInitialWorkspaceId(ids, "northwind", "acme")).toBe(
      "northwind",
    );
    expect(resolveInitialWorkspaceId(ids, "unknown", "acme")).toBe("acme");
    expect(resolveInitialWorkspaceId(ids, null, null, "northwind")).toBe(
      "northwind",
    );
    expect(resolveInitialWorkspaceId(ids, null, null)).toBeNull();
    expect(resolveInitialWorkspaceId(["acme"], null, null)).toBe("acme");
  });

  test("generates canonical, encoded workspace paths", () => {
    expect(workspacePath("workspace-one", "settings")).toBe(
      "/w/workspace-one/settings",
    );
    expect(workspacePath("workspace/one", "settings", "notifications")).toBe(
      "/w/workspace%2Fone/settings/notifications",
    );
    expect(workspacePath("workspace-one", "chat", "contact-one")).toBe(
      "/w/workspace-one/chat/contact-one",
    );
  });

  test("reads canonical and compatibility destinations", () => {
    expect(getWorkspaceDestination("/w/acme/settings/labels")).toEqual({
      destination: "settings",
      suffix: "labels",
    });
    expect(getWorkspaceDestination("/dashboard")).toEqual({
      destination: "dashboard",
      suffix: undefined,
    });
  });

  test("keeps allowed destinations after switching", () => {
    expect(
      resolveWorkspaceDestination(
        "northwind",
        "/w/acme/dashboard",
        permissions,
      ),
    ).toEqual({
      path: "/w/northwind/dashboard",
      wasRedirected: false,
    });
  });

  test("redirects forbidden destinations and selected conversations to Inbox", () => {
    expect(
      resolveWorkspaceDestination("northwind", "/w/acme/audit", permissions),
    ).toEqual({ path: "/w/northwind/chat", wasRedirected: true });
    expect(
      resolveWorkspaceDestination(
        "northwind",
        "/w/acme/chat/contact-one",
        permissions,
      ),
    ).toEqual({ path: "/w/northwind/chat", wasRedirected: true });
  });

  test("allows Team for invite-only memberships", () => {
    expect(
      resolveWorkspaceDestination("northwind", "/w/acme/team", {
        ...permissions,
        can_view_dashboard: false,
        can_invite: true,
      }),
    ).toEqual({ path: "/w/northwind/team", wasRedirected: false });
  });
});

describe("chat view query param", () => {
  test("defaults to all chats when the param is absent or unknown", () => {
    expect(parseChatView("")).toBe("chats");
    expect(parseChatView("?view=chats")).toBe("chats");
    expect(parseChatView("?view=archived")).toBe("chats");
    expect(parseChatView("?contact=1")).toBe("chats");
  });

  test("reads the groups filter", () => {
    expect(parseChatView("?view=groups")).toBe("groups");
    expect(parseChatView("?q=hi&view=groups")).toBe("groups");
  });

  test("round-trips through withChatView while preserving other params", () => {
    expect(withChatView("?q=hi", "groups")).toBe("?q=hi&view=groups");
    expect(withChatView("?q=hi&view=groups", "chats")).toBe("?q=hi");
    expect(withChatView("?view=groups", "chats")).toBe("");
    expect(parseChatView(withChatView("", "groups"))).toBe("groups");
  });

  test("never stacks duplicate view params", () => {
    expect(withChatView("?view=groups", "groups")).toBe("?view=groups");
  });

  test("builds conversation-aware paths for both filters", () => {
    expect(chatViewPath("northwind", "chats")).toBe("/w/northwind/chat");
    expect(chatViewPath("northwind", "groups")).toBe(
      "/w/northwind/chat?view=groups",
    );
    expect(chatViewPath("northwind", "groups", "contact-one")).toBe(
      "/w/northwind/chat/contact-one?view=groups",
    );
  });

  test("leaves the pathname destination unaffected by the filter", () => {
    expect(getWorkspaceDestination("/w/northwind/chat/contact-one")).toEqual({
      destination: "chat",
      suffix: "contact-one",
    });
  });
});
