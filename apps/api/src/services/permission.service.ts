import { db } from "@wateaminbox/database";
import type { MemberPermissions } from "@wateaminbox/shared";
import { NotFoundError, ForbiddenError } from "../lib/errors.js";

/**
 * Feature-based permissions
 * These granular permissions control specific actions within the application
 */
export const PERMISSIONS = {
  // Chat & Messaging
  CAN_VIEW_ALL_CHATS: "can_view_all_chats",
  CAN_SEND_MESSAGES: "can_send_messages",

  // Contact Management
  CAN_ASSIGN_CONTACTS: "can_assign_contacts",

  // Team Management
  CAN_MANAGE_TEAM: "can_manage_team",
  CAN_INVITE: "can_invite",

  // Workspace administration
  CAN_MANAGE_CONNECTIONS: "can_manage_connections",
  CAN_VIEW_DASHBOARD: "can_view_dashboard",
  CAN_VIEW_AUDIT: "can_view_audit",

  // Data Management
  CAN_EXPORT: "can_export",
  CAN_DELETE: "can_delete",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export type { MemberPermissions } from "@wateaminbox/shared";

/**
 * Default permission presets for each role
 * Owner: All permissions
 * Admin: All except manage_team
 * Member (Agent): Basic messaging permissions
 */
export const ROLE_PRESETS: Record<
  "owner" | "admin" | "member",
  MemberPermissions
> = {
  owner: {
    can_view_all_chats: true,
    can_send_messages: true,
    can_assign_contacts: true,
    can_manage_team: true,
    can_invite: true,
    can_manage_connections: true,
    can_view_dashboard: true,
    can_view_audit: true,
    can_export: true,
    can_delete: true,
  },
  admin: {
    can_view_all_chats: true,
    can_send_messages: true,
    can_assign_contacts: true,
    can_manage_team: true,
    can_invite: true,
    can_manage_connections: true,
    can_view_dashboard: true,
    can_view_audit: true,
    can_export: true,
    can_delete: true,
  },
  member: {
    can_view_all_chats: false,
    can_send_messages: true,
    can_assign_contacts: false,
    can_manage_team: false,
    can_invite: false,
    can_manage_connections: false,
    can_view_dashboard: false,
    can_view_audit: false,
    can_export: false,
    can_delete: false,
  },
};

/**
 * Gets the effective permissions for a member
 * Merges role-based defaults with any custom permissions
 */
export function getEffectivePermissions(
  role: "owner" | "admin" | "member",
  customPermissions: Partial<MemberPermissions> = {},
): MemberPermissions {
  const roleDefaults = ROLE_PRESETS[role];

  // Owner always has all permissions, ignore custom overrides
  if (role === "owner") {
    return roleDefaults;
  }

  // Merge custom permissions with role defaults
  return {
    ...roleDefaults,
    ...customPermissions,
  };
}

/**
 * Gets member data including role and permissions from database
 */
export async function getMemberWithPermissions(
  companyId: string,
  userId: string,
): Promise<{
  role: "owner" | "admin" | "member";
  permissions: MemberPermissions;
} | null> {
  const member = await db
    .selectFrom("company_members")
    .select(["role", "permissions"])
    .where("company_id", "=", companyId)
    .where("user_id", "=", userId)
    .executeTakeFirst();

  if (!member) {
    return null;
  }

  const role = member.role as "owner" | "admin" | "member";
  const customPermissions = (member.permissions ||
    {}) as Partial<MemberPermissions>;

  return {
    role,
    permissions: getEffectivePermissions(role, customPermissions),
  };
}

/**
 * Checks if a user has a specific permission
 */
export async function hasFeaturePermission(
  companyId: string,
  userId: string,
  permission: Permission,
): Promise<boolean> {
  const memberData = await getMemberWithPermissions(companyId, userId);

  if (!memberData) {
    return false;
  }

  return memberData.permissions[permission] === true;
}

/**
 * Checks if a user has all of the specified permissions
 */
export async function hasAllPermissions(
  companyId: string,
  userId: string,
  permissions: Permission[],
): Promise<boolean> {
  const memberData = await getMemberWithPermissions(companyId, userId);

  if (!memberData) {
    return false;
  }

  return permissions.every((p) => memberData.permissions[p] === true);
}

/**
 * Checks if a user has any of the specified permissions
 */
export async function hasAnyPermission(
  companyId: string,
  userId: string,
  permissions: Permission[],
): Promise<boolean> {
  const memberData = await getMemberWithPermissions(companyId, userId);

  if (!memberData) {
    return false;
  }

  return permissions.some((p) => memberData.permissions[p] === true);
}

/**
 * Updates custom permissions for a member
 * Only owner can update permissions
 * Owner's permissions cannot be changed
 */
export async function updateMemberPermissions(
  companyId: string,
  targetUserId: string,
  newPermissions: Partial<MemberPermissions>,
): Promise<MemberPermissions> {
  // First get the member's current role
  const member = await db
    .selectFrom("company_members")
    .select(["role", "permissions"])
    .where("company_id", "=", companyId)
    .where("user_id", "=", targetUserId)
    .executeTakeFirst();

  if (!member) {
    throw new NotFoundError("Member");
  }

  const role = member.role as "owner" | "admin" | "member";

  // Cannot change owner's permissions
  if (role === "owner") {
    throw new ForbiddenError("Cannot modify owner's permissions");
  }

  // Merge existing custom permissions with new ones
  const currentCustom = (member.permissions ||
    {}) as Partial<MemberPermissions>;
  const updatedPermissions = {
    ...currentCustom,
    ...newPermissions,
  };

  await db
    .updateTable("company_members")
    .set({ permissions: updatedPermissions })
    .where("company_id", "=", companyId)
    .where("user_id", "=", targetUserId)
    .execute();

  return getEffectivePermissions(role, updatedPermissions);
}

/**
 * Resets a member's permissions to their role defaults
 */
export async function resetMemberPermissions(
  companyId: string,
  targetUserId: string,
): Promise<MemberPermissions> {
  const member = await db
    .selectFrom("company_members")
    .select(["role"])
    .where("company_id", "=", companyId)
    .where("user_id", "=", targetUserId)
    .executeTakeFirst();

  if (!member) {
    throw new NotFoundError("Member");
  }

  const role = member.role as "owner" | "admin" | "member";

  // Clear custom permissions
  await db
    .updateTable("company_members")
    .set({ permissions: {} })
    .where("company_id", "=", companyId)
    .where("user_id", "=", targetUserId)
    .execute();

  return ROLE_PRESETS[role];
}

/**
 * Gets all available permissions with their descriptions
 */
export function getPermissionDescriptions(): Array<{
  key: Permission;
  name: string;
  description: string;
  category: string;
}> {
  return [
    {
      key: PERMISSIONS.CAN_VIEW_ALL_CHATS,
      name: "View All Chats",
      description: "Can see all conversations, not just assigned ones",
      category: "Chat & Messaging",
    },
    {
      key: PERMISSIONS.CAN_SEND_MESSAGES,
      name: "Send Messages",
      description: "Can send messages to contacts",
      category: "Chat & Messaging",
    },
    {
      key: PERMISSIONS.CAN_ASSIGN_CONTACTS,
      name: "Assign Contacts",
      description: "Can assign contacts to team members",
      category: "Contact Management",
    },
    {
      key: PERMISSIONS.CAN_MANAGE_TEAM,
      name: "Manage Team",
      description: "Can manage team members, roles, and permissions",
      category: "Team Management",
    },
    {
      key: PERMISSIONS.CAN_INVITE,
      name: "Invite Members",
      description: "Can invite new members to the company",
      category: "Team Management",
    },
    {
      key: PERMISSIONS.CAN_MANAGE_CONNECTIONS,
      name: "Manage Connections",
      description:
        "Can add, reconnect, rename, and remove WhatsApp connections",
      category: "Workspace",
    },
    {
      key: PERMISSIONS.CAN_VIEW_DASHBOARD,
      name: "View Dashboard",
      description: "Can view workspace analytics and operational metrics",
      category: "Workspace",
    },
    {
      key: PERMISSIONS.CAN_VIEW_AUDIT,
      name: "View Audit Log",
      description: "Can view workspace activity and security logs",
      category: "Workspace",
    },
    {
      key: PERMISSIONS.CAN_EXPORT,
      name: "Export Data",
      description: "Can export contacts, messages, and reports",
      category: "Data Management",
    },
    {
      key: PERMISSIONS.CAN_DELETE,
      name: "Delete Data",
      description: "Can delete contacts and messages",
      category: "Data Management",
    },
  ];
}
