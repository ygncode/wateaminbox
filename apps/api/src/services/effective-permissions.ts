import {
  type MemberPermissions,
  ROLE_PERMISSION_PRESETS,
} from "@wateaminbox/shared";

/**
 * Resolve role defaults plus member-specific overrides.
 *
 * Kept dependency-free so read paths such as realtime membership caching do
 * not import the permission mutation service and create an initialization
 * cycle.
 */
export function getEffectivePermissions(
  role: "owner" | "admin" | "member",
  customPermissions: Partial<MemberPermissions> = {},
): MemberPermissions {
  const roleDefaults = ROLE_PERMISSION_PRESETS[role];

  // Owner permissions cannot be weakened by per-member overrides.
  if (role === "owner") return roleDefaults;

  return {
    ...roleDefaults,
    ...customPermissions,
  };
}

export type { MemberPermissions } from "@wateaminbox/shared";
