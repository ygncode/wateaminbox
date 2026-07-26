/**
 * Company service types
 *
 * Shared type definitions for company, members, and invitations
 */

/**
 * Company entity
 */
export interface Company {
  id: string;
  name: string;
  schema_name: string;
  status: "active" | "suspended" | "deleted";
  created_at: Date;
  updated_at: Date;
}

/**
 * Company member entity with joined user data
 */
export interface CompanyMember {
  id: string;
  user_id: string;
  company_id: string;
  role: "owner" | "admin" | "member";
  permissions: Record<string, unknown>;
  invited_by: string | null;
  joined_at: Date;
  /** Identity fields from the joined users table. */
  name?: string | null;
  email?: string;
}

/**
 * Invitation entity
 */
export interface Invitation {
  id: string;
  company_id: string;
  email: string;
  role: "admin" | "member";
  token: string;
  invited_by: string;
  inviter_name?: string | null;
  inviter_email?: string;
  expires_at: Date;
  accepted_at: Date | null;
  created_at: Date;
}

/**
 * Input for creating a new company
 */
export interface CreateCompanyInput {
  name: string;
}

/**
 * Input for updating a company
 */
export interface UpdateCompanyInput {
  name?: string;
  status?: "active" | "suspended";
}

/**
 * Input for inviting a member
 */
export interface InviteMemberInput {
  email: string;
  role?: "admin" | "member";
}

/**
 * Result of accepting an invitation
 */
export interface AcceptInvitationResult {
  company: Company;
  member: CompanyMember;
}

/**
 * Invitation preview data returned by getInvitationByToken
 */
export interface InvitationPreview {
  id: string;
  email: string;
  companyName: string;
  invitedBy: string;
  role: "admin" | "member";
  expiresAt: Date;
  createdAt: Date;
}

/**
 * Company with user's role attached
 */
export interface CompanyWithRole extends Company {
  role: "owner" | "admin" | "member";
  permissions: import("@wateaminbox/shared").MemberPermissions;
}
