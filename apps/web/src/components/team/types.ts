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
  onSearchChange: (search: string) => void;
  onRoleFilterChange: (role: "all" | "owner" | "admin" | "member") => void;
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
  currentUserRole: "owner" | "admin" | "member";
  onClose: () => void;
}
