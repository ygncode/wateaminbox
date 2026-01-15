import { useState } from "react";
import { useAsyncData } from "@/hooks/useAsyncData";
import {
  useCompanyMembers,
  useRemoveMember,
  useUpdateMemberRole,
} from "@/hooks/useTeam";
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

  const isAdmin = currentUserRole === "owner" || currentUserRole === "admin";

  const handleRoleChange = async (
    userId: string,
    newRole: "admin" | "member",
  ) => {
    await updateRole.mutateAsync({ companyId, userId, role: newRole });
    setMenuOpenFor(null);
  };

  const handleRemove = async (userId: string) => {
    if (confirm("Are you sure you want to remove this member?")) {
      await removeMember.mutateAsync({ companyId, userId });
    }
    setMenuOpenFor(null);
  };

  return renderState({
    loading: () => (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <MemberSkeleton key={i} />
        ))}
      </div>
    ),
    error: () => (
      <div className="text-center text-red-500 dark:text-red-400">
        Failed to load team members
      </div>
    ),
    empty: () => (
      <div className="text-center text-gray-500 dark:text-dark-text-secondary py-8">
        No team members found
      </div>
    ),
    success: (members) => (
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
    ),
  });
}
