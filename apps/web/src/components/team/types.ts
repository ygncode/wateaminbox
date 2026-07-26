import type { CompanyMember, Invitation } from "@/hooks/useTeam";

export type { CompanyMember, Invitation };

export interface TeamManagementProps {
  companyId: string;
  currentUserId: string;
  currentUserRole: "owner" | "admin" | "member";
  canManageTeam: boolean;
  canInvite: boolean;
}

export interface MembersListProps {
  companyId: string;
  currentUserId: string;
  currentUserRole: "owner" | "admin" | "member";
  search: string;
  roleFilter: "all" | "owner" | "admin" | "member";
}

export interface MemberCardProps {
  member: CompanyMember;
  isCurrentUser: boolean;
  canChangeRole: boolean;
  canEditPermissions: boolean;
  canRemove: boolean;
  isMenuOpen: boolean;
  onMenuToggle: () => void;
  onRoleChange: (role: "admin" | "member") => void;
  onEditPermissions: () => void;
  onRemove: () => void;
}

export interface InvitationsListProps {
  companyId: string;
  search?: string;
}

export interface InvitationCardProps {
  invitation: Invitation;
  onCancel: () => void;
  onResend: () => void;
  isCancelling: boolean;
  isResending: boolean;
}

export interface InviteFormModalProps {
  companyId: string;
  onClose: () => void;
}
