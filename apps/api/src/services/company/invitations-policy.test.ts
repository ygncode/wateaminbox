import { describe, expect, test } from "bun:test";
import {
  canInviteRole,
  normalizeInvitationPermissions,
} from "./invitations.js";

describe("invitation access policy", () => {
  test("prevents inviters from creating a higher role", () => {
    expect(canInviteRole("owner", "admin")).toBe(true);
    expect(canInviteRole("admin", "admin")).toBe(true);
    expect(canInviteRole("admin", "member")).toBe(true);
    expect(canInviteRole("member", "member")).toBe(true);
    expect(canInviteRole("member", "admin")).toBe(false);
  });

  test("stores only values that differ from role defaults", () => {
    expect(
      normalizeInvitationPermissions("admin", {
        can_send_messages: true,
        can_export: false,
      }),
    ).toEqual({ can_export: false });
    expect(
      normalizeInvitationPermissions("member", {
        can_send_messages: false,
        can_view_dashboard: true,
      }),
    ).toEqual({
      can_send_messages: false,
      can_view_dashboard: true,
    });
  });
});
