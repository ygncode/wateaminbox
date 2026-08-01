import { describe, expect, test } from "bun:test";
import type { MemberPermissions } from "@wateaminbox/shared";
import {
  getWorkspaceDestination,
  resolveInitialWorkspaceId,
  resolveWorkspaceDestination,
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
