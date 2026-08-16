import { describe, expect, test } from "bun:test";
import { type MemberPermissions, ROLE_PERMISSION_PRESETS } from "./company";

describe("ROLE_PERMISSION_PRESETS", () => {
  test("member defaults grant chat and messaging plus contact management", () => {
    expect(ROLE_PERMISSION_PRESETS.member).toEqual({
      // Chat and messaging
      can_view_all_chats: true,
      can_send_messages: true,
      can_send_bulk_messages: true,
      // Contact management
      can_assign_contacts: true,
      // Team management
      can_manage_team: false,
      can_invite: false,
      // Workspace administration
      can_manage_connections: false,
      can_view_dashboard: false,
      can_view_audit: false,
      // Data management
      can_export: false,
      can_delete: false,
    } satisfies MemberPermissions);
  });

  test("owner and admin keep every permission", () => {
    expect(Object.values(ROLE_PERMISSION_PRESETS.owner).every(Boolean)).toBe(
      true,
    );
    expect(Object.values(ROLE_PERMISSION_PRESETS.admin).every(Boolean)).toBe(
      true,
    );
  });
});
