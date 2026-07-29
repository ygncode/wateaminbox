/**
 * Company service barrel export
 *
 * Provides all company functions organized by domain.
 */

// Re-export error classes for backward compatibility
export {
  CompanyNotFoundError,
  InsufficientPermissionsError,
  InvitationExpiredError,
  InvitationNotFoundError,
  UserAlreadyMemberError,
} from "../../lib/errors.js";

// Core CRUD operations
export {
  createCompany,
  deleteCompany,
  getCompany,
  toCompanyResponse,
  updateCompany,
} from "./core.js";
// Invitation operations
export {
  acceptInvitation,
  cancelInvitation,
  getInvitationByToken,
  getPendingInvitations,
  inviteMember,
  resendInvitation,
} from "./invitations.js";
// Member operations
export {
  canManageMember,
  getMemberRole,
  getMembers,
  getUserCompanies,
  hasPermission,
  removeMember,
  transferOwnership,
  updateMemberRole,
} from "./members.js";
// Types
export type {
  AcceptInvitationResult,
  Company,
  CompanyMember,
  CompanyWithRole,
  CreateCompanyInput,
  Invitation,
  InvitationPreview,
  InviteMemberInput,
  UpdateCompanyInput,
} from "./types.js";
