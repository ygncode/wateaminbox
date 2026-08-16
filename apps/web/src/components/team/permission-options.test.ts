import { describe, expect, test } from "bun:test";
import { ROLE_PERMISSION_PRESETS } from "@wateaminbox/shared";
import { permissionGroups, permissionOptions } from "./permission-options";

/**
 * The invite modal and the member permissions dialog both render
 * `permissionGroups` pre-filled from `ROLE_PERMISSION_PRESETS`, so the preset
 * decides which checkboxes an invited member starts with.
 */
function enabledGroupsFor(role: "owner" | "admin" | "member"): string[] {
  const preset = ROLE_PERMISSION_PRESETS[role];
  return permissionGroups
    .filter((group) => group.options.every((option) => preset[option.key]))
    .map((group) => group.label);
}

describe("role presets against the permission UI groups", () => {
  test("every permission key is offered exactly once in the UI", () => {
    const keys = permissionOptions.map((option) => option.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.sort()).toEqual(
      Object.keys(ROLE_PERMISSION_PRESETS.member).sort() as typeof keys,
    );
  });

  test("member defaults enable the whole Chat and messaging and Contact management groups, and nothing else", () => {
    expect(enabledGroupsFor("member")).toEqual([
      "Chat and messaging",
      "Contact management",
    ]);
  });

  test("no member default outside those two groups is enabled", () => {
    const memberPreset = ROLE_PERMISSION_PRESETS.member;
    const restrictedGroups = permissionGroups.filter(
      (group) =>
        !["Chat and messaging", "Contact management"].includes(group.label),
    );

    for (const group of restrictedGroups) {
      for (const option of group.options) {
        expect(memberPreset[option.key], `${group.label}/${option.key}`).toBe(
          false,
        );
      }
    }
  });

  test("owner and admin defaults enable every group", () => {
    const allGroups = permissionGroups.map((group) => group.label);
    expect(enabledGroupsFor("owner")).toEqual(allGroups);
    expect(enabledGroupsFor("admin")).toEqual(allGroups);
  });
});
