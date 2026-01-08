/**
 * Company service barrel export
 *
 * Provides all company functions organized by domain.
 */

// Types
export type {
  Company,
  CompanyMember,
  CompanyWithRole,
  CreateCompanyInput,
  UpdateCompanyInput,
  Invitation,
  InviteMemberInput,
  AcceptInvitationResult,
  InvitationPreview,
} from "./types.js";

// Core CRUD operations
export {
  createCompany,
  getCompany,
  updateCompany,
  deleteCompany,
} from "./core.js";

// Member operations
export {
  getMembers,
  getMemberRole,
  hasPermission,
  removeMember,
  updateMemberRole,
  getUserCompanies,
} from "./members.js";

// Invitation operations
export {
  inviteMember,
  getPendingInvitations,
  cancelInvitation,
  acceptInvitation,
  getInvitationByToken,
  resendInvitation,
} from "./invitations.js";

// Re-export error classes for backward compatibility
export {
  CompanyNotFoundError,
  InsufficientPermissionsError,
  InvitationExpiredError,
  InvitationNotFoundError,
  UserAlreadyMemberError,
} from "../../lib/errors.js";
