/**
 * Company status enumeration
 */
export type CompanyStatus = "active" | "suspended" | "deleted";

/**
 * Company member role enumeration
 */
export type CompanyMemberRole = "owner" | "admin" | "member";

/**
 * Base company entity for API responses
 *
 * Used in frontend API responses. For database entities, see API-specific types.
 */
export interface Company {
  id: string;
  name: string;
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
}

/**
 * Invitation entity for pending invitations
 */
export interface CompanyInvitation {
  id: string;
  companyId: string;
  email: string;
  role: Exclude<CompanyMemberRole, "owner">;
  token: string;
  invitedBy: string;
  expiresAt: string;
  createdAt: string;
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
  status?: Exclude<CompanyStatus, "deleted">;
}

/**
 * Input for inviting a member to a company
 */
export interface InviteMemberInput {
  email: string;
  role?: Exclude<CompanyMemberRole, "owner">;
}
