/**
 * Company status enumeration
 */
export type CompanyStatus = "active" | "suspended" | "deleted";

/**
 * Company member role enumeration
 */
export type CompanyMemberRole = "owner" | "admin" | "member";

/** Effective workspace capabilities for a company member. */
export interface MemberPermissions {
  can_view_all_chats: boolean;
  can_send_messages: boolean;
  can_assign_contacts: boolean;
  can_manage_team: boolean;
  can_invite: boolean;
  can_manage_connections: boolean;
  can_view_dashboard: boolean;
  can_view_audit: boolean;
  can_export: boolean;
  can_delete: boolean;
}

/** Canonical role defaults used when resolving workspace access. */
export const ROLE_PERMISSION_PRESETS: Record<
  CompanyMemberRole,
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
 * Base company entity for API responses
 *
 * Used in frontend API responses. For database entities, see API-specific types.
 */
export interface Company {
  id: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  status: CompanyStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Company with the current user's role attached
 *
 * Returned by getUserCompanies and similar endpoints
 */
export interface CompanyWithRole extends Company {
  role: CompanyMemberRole;
  permissions: MemberPermissions;
}

/**
 * Company member entity with user details
 */
export interface CompanyMember {
  id: string;
  userId: string;
  companyId: string;
  role: CompanyMemberRole;
  joinedAt: string;
  /** User ID who invited this member (null for owner) */
  invitedBy: string | null;
  /** User's name (from joined user data) */
  name?: string;
  /** User's email (from joined user data) */
  email: string;
  /** Explicit per-member overrides stored in the company membership. */
  permissions?: Partial<MemberPermissions>;
  /** Role defaults merged with explicit overrides. */
  effectivePermissions?: MemberPermissions;
}

/**
 * Invitation entity for pending invitations
 */
export interface CompanyInvitation {
  id: string;
  companyId: string;
  email: string;
  role: Exclude<CompanyMemberRole, "owner">;
  /** Explicit access overrides applied when the invitation is accepted. */
  permissions?: Partial<MemberPermissions>;
  /** Role defaults merged with the invitation's explicit overrides. */
  effectivePermissions?: MemberPermissions;
  token: string;
  invitedBy: string;
  inviterName?: string | null;
  inviterEmail?: string;
  deliveryState?: "delivered" | "pending";
  expiresAt: string;
  createdAt: string;
}

/**
 * Input for creating a new company
 */
export interface CreateCompanyInput {
  name: string;
  description?: string;
  logoDataUrl?: string;
}

/**
 * Input for updating a company
 */
export interface UpdateCompanyInput {
  name?: string;
  description?: string;
  /** Processed data URL replaces the logo; null removes the current logo. */
  logoDataUrl?: string | null;
  status?: Exclude<CompanyStatus, "deleted">;
}

/**
 * Input for inviting a member to a company
 */
export interface InviteMemberInput {
  email: string;
  role?: Exclude<CompanyMemberRole, "owner">;
  /** Owner-selected overrides; omitted or empty means role defaults. */
  permissions?: Partial<MemberPermissions>;
}
