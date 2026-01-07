import { useMemo } from "react";
import { useAuth } from "../contexts/auth-context";

/**
 * Feature-based permissions matching the backend
 */
export interface MemberPermissions {
  can_view_all_chats: boolean;
  can_send_messages: boolean;
  can_assign_contacts: boolean;
  can_manage_team: boolean;
  can_invite: boolean;
  can_export: boolean;
  can_delete: boolean;
}

/**
 * Permission keys
 */
export const PERMISSIONS = {
  CAN_VIEW_ALL_CHATS: "can_view_all_chats",
  CAN_SEND_MESSAGES: "can_send_messages",
  CAN_ASSIGN_CONTACTS: "can_assign_contacts",
  CAN_MANAGE_TEAM: "can_manage_team",
  CAN_INVITE: "can_invite",
  CAN_EXPORT: "can_export",
  CAN_DELETE: "can_delete",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/**
 * Default permission presets for each role
 * Must match backend ROLE_PRESETS
 */
const ROLE_PRESETS: Record<"owner" | "admin" | "member", MemberPermissions> = {
  owner: {
    can_view_all_chats: true,
    can_send_messages: true,
    can_assign_contacts: true,
    can_manage_team: true,
    can_invite: true,
    can_export: true,
    can_delete: true,
  },
  admin: {
    can_view_all_chats: true,
    can_send_messages: true,
    can_assign_contacts: true,
    can_manage_team: false,
    can_invite: true,
    can_export: true,
    can_delete: true,
  },
  member: {
    can_view_all_chats: false,
    can_send_messages: true,
    can_assign_contacts: false,
    can_manage_team: false,
    can_invite: false,
    can_export: false,
    can_delete: false,
  },
};

/**
 * Hook to get current user's role and permissions
 */
export function usePermissions(): {
  role: "owner" | "admin" | "member" | null;
  permissions: MemberPermissions | null;
  hasPermission: (permission: Permission) => boolean;
  hasAnyPermission: (permissions: Permission[]) => boolean;
  hasAllPermissions: (permissions: Permission[]) => boolean;
  isOwner: boolean;
  isAdmin: boolean;
  canViewAllChats: boolean;
  canSendMessages: boolean;
  canAssignContacts: boolean;
  canManageTeam: boolean;
  canInvite: boolean;
  canExport: boolean;
  canDelete: boolean;
} {
  const { companies, currentCompanyId } = useAuth();

  const { role, permissions } = useMemo(() => {
    if (!currentCompanyId || !companies.length) {
      return { role: null, permissions: null };
    }

    const company = companies.find((c) => c.id === currentCompanyId);
    if (!company) {
      return { role: null, permissions: null };
    }

    const role = company.role;
    // Get default permissions based on role
    // In a full implementation, we'd fetch custom permissions from the API
    const permissions = ROLE_PRESETS[role];

    return { role, permissions };
  }, [companies, currentCompanyId]);

  const hasPermission = useMemo(() => {
    return (permission: Permission): boolean => {
      if (!permissions) return false;
      return permissions[permission] === true;
    };
  }, [permissions]);

  const hasAnyPermission = useMemo(() => {
    return (perms: Permission[]): boolean => {
      if (!permissions) return false;
      return perms.some((p) => permissions[p] === true);
    };
  }, [permissions]);

  const hasAllPermissions = useMemo(() => {
    return (perms: Permission[]): boolean => {
      if (!permissions) return false;
      return perms.every((p) => permissions[p] === true);
    };
  }, [permissions]);

  return {
    role,
    permissions,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    isOwner: role === "owner",
    isAdmin: role === "admin" || role === "owner",
    canViewAllChats: hasPermission(PERMISSIONS.CAN_VIEW_ALL_CHATS),
    canSendMessages: hasPermission(PERMISSIONS.CAN_SEND_MESSAGES),
    canAssignContacts: hasPermission(PERMISSIONS.CAN_ASSIGN_CONTACTS),
    canManageTeam: hasPermission(PERMISSIONS.CAN_MANAGE_TEAM),
    canInvite: hasPermission(PERMISSIONS.CAN_INVITE),
    canExport: hasPermission(PERMISSIONS.CAN_EXPORT),
    canDelete: hasPermission(PERMISSIONS.CAN_DELETE),
  };
}

/**
 * Hook to check a single permission
 */
export function useHasPermission(permission: Permission): boolean {
  const { hasPermission } = usePermissions();
  return hasPermission(permission);
}
