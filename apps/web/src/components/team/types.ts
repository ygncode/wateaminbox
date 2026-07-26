import type { CompanyMember, Invitation } from "@/hooks/useTeam";

export type { CompanyMember, Invitation };

export interface TeamManagementProps {
  companyId: string;
  currentUserId: string;
  currentUserRole: "owner" | "admin" | "member";
}

export interface MembersListProps {
  companyId: string;
  currentUserId: string;
  currentUserRole: "owner" | "admin" | "member";
}

export interface MemberCardProps {
  member: CompanyMember;
  isCurrentUser: boolean;
  canManage: boolean;
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
  onClose: () => void;
}
