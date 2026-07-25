import { useState } from "react";
import { useAsyncData } from "@/hooks/useAsyncData";
import {
  useCompanyMembers,
  useRemoveMember,
  useUpdateMemberRole,
} from "@/hooks/useTeam";
import { ConfirmationDialog } from "@/components/ui";
import { MemberCard } from "./MemberCard";
import { MemberSkeleton } from "./MemberSkeleton";
import type { MembersListProps } from "./types";

/**
 * Members list component
 */
export function MembersList({
  companyId,
  currentUserId,
  currentUserRole,
}: MembersListProps) {
  const { renderState } = useAsyncData(useCompanyMembers(companyId));
  const updateRole = useUpdateMemberRole();
  const removeMember = useRemoveMember();
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);

  const isAdmin = currentUserRole === "owner" || currentUserRole === "admin";
  const actionError = updateRole.error || removeMember.error;

  const handleRoleChange = async (
    userId: string,
    newRole: "admin" | "member",
  ) => {
    try {
      await updateRole.mutateAsync({ companyId, userId, role: newRole });
      setMenuOpenFor(null);
    } catch {
      // React Query exposes the error in the action banner below.
    }
  };

  const handleRemove = (userId: string) => {
    setPendingRemove(userId);
    setMenuOpenFor(null);
  };

  const handleConfirmRemove = async () => {
    if (!pendingRemove) return;
    try {
      await removeMember.mutateAsync({ companyId, userId: pendingRemove });
      setPendingRemove(null);
    } catch {
      // Keep the confirmation open and show the API error.
    }
  };

  return renderState({
    loading: () => (
      <div className="space-y-4" aria-live="polite" aria-busy="true">
        <span className="sr-only">Loading team members</span>
        {[1, 2, 3].map((i) => (
          <MemberSkeleton key={i} />
        ))}
      </div>
    ),
    error: () => (
      <div
        className="text-center text-red-500 dark:text-red-400"
        role="alert"
        aria-live="assertive"
      >
        Failed to load team members
      </div>
    ),
    empty: () => (
      <div
        className="text-center text-gray-500 dark:text-dark-text-secondary py-8"
        aria-live="polite"
      >
        No team members found
      </div>
    ),
    success: (members) => (
      <>
        {actionError && (
          <div
            role="alert"
            className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300"
          >
            {actionError.message || "Could not update this team member"}
          </div>
        )}
        <div className="space-y-2">
          {members.map((member) => (
            <MemberCard
              key={member.id}
              member={member}
              isCurrentUser={member.userId === currentUserId}
              canManage={
                isAdmin &&
                member.role !== "owner" &&
                member.userId !== currentUserId
              }
              isMenuOpen={menuOpenFor === member.id}
              onMenuToggle={() =>
                setMenuOpenFor(menuOpenFor === member.id ? null : member.id)
              }
              onRoleChange={(role) => handleRoleChange(member.userId, role)}
              onRemove={() => handleRemove(member.userId)}
            />
          ))}
        </div>

        <ConfirmationDialog
          open={pendingRemove !== null}
          onOpenChange={(open) => !open && setPendingRemove(null)}
          title="Remove team member"
          description="Are you sure you want to remove this member from the team? They will lose access to all conversations and data."
          confirmText="Remove"
          cancelText="Cancel"
          isDestructive
          isLoading={removeMember.isPending}
          onConfirm={handleConfirmRemove}
          onCancel={() => setPendingRemove(null)}
        />
      </>
    ),
  });
}
