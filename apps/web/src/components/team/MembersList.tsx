import type { CompanyMember, MemberPermissions } from "@wateaminbox/shared";
import { useState } from "react";
import { ConfirmationDialog } from "@/components/ui";
import { useAsyncData } from "@/hooks/useAsyncData";
import {
  useCompanyMembers,
  useRemoveMember,
  useResetMemberPermissions,
  useUpdateMemberPermissions,
  useUpdateMemberRole,
} from "@/hooks/useTeam";
import { MemberCard } from "./MemberCard";
import { MemberPermissionsDialog } from "./MemberPermissionsDialog";
import { MemberSkeleton } from "./MemberSkeleton";
import type { MembersListProps } from "./types";

const roleRank = { owner: 3, admin: 2, member: 1 } as const;

export function MembersList({
  companyId,
  currentUserId,
  currentUserRole,
  search,
  roleFilter,
}: MembersListProps) {
  const { renderState } = useAsyncData(useCompanyMembers(companyId));
  const updateRole = useUpdateMemberRole();
  const updatePermissions = useUpdateMemberPermissions();
  const resetPermissions = useResetMemberPermissions();
  const removeMember = useRemoveMember();
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const [permissionMember, setPermissionMember] =
    useState<CompanyMember | null>(null);
  const actionError =
    updateRole.error ||
    updatePermissions.error ||
    resetPermissions.error ||
    removeMember.error;

  const handleRoleChange = async (
    userId: string,
    newRole: "admin" | "member",
  ) => {
    try {
      await updateRole.mutateAsync({ companyId, userId, role: newRole });
      setMenuOpenFor(null);
    } catch {
      // Mutation state renders the server policy error.
    }
  };
  const handlePermissionsSave = async (permissions: MemberPermissions) => {
    if (!permissionMember) return;
    await updatePermissions.mutateAsync({
      companyId,
      userId: permissionMember.userId,
      permissions,
    });
    setPermissionMember(null);
  };
  const handlePermissionsReset = async () => {
    if (!permissionMember) return;
    await resetPermissions.mutateAsync({
      companyId,
      userId: permissionMember.userId,
    });
    setPermissionMember(null);
  };
  const handleConfirmRemove = async () => {
    if (!pendingRemove) return;
    try {
      await removeMember.mutateAsync({ companyId, userId: pendingRemove });
      setPendingRemove(null);
    } catch {
      // Keep the dialog open so the policy error remains visible.
    }
  };

  return renderState({
    loading: () => (
      <div className="space-y-3" aria-live="polite" aria-busy="true">
        <span className="sr-only">Loading team members</span>
        {[1, 2, 3].map((item) => (
          <MemberSkeleton key={item} />
        ))}
      </div>
    ),
    error: () => (
      <div className="py-12 text-center text-red-500" role="alert">
        Failed to load team members
      </div>
    ),
    empty: () => (
      <div className="py-12 text-center text-[#65736d] dark:text-dark-text-secondary">
        No team members found
      </div>
    ),
    success: (members) => {
      const normalizedSearch = search.trim().toLocaleLowerCase();
      const filtered = members.filter((member) => {
        const matchesSearch =
          !normalizedSearch ||
          `${member.name || ""} ${member.email}`
            .toLocaleLowerCase()
            .includes(normalizedSearch);
        return (
          matchesSearch && (roleFilter === "all" || member.role === roleFilter)
        );
      });
      return (
        <>
          {actionError && (
            <div
              role="alert"
              className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300"
            >
              {actionError.message || "Could not update this team member"}
            </div>
          )}
          {filtered.length ? (
            <div className="overflow-hidden rounded-xl border border-[#dce3de] bg-white dark:border-dark-border dark:bg-dark-elevated">
              <div className="hidden grid-cols-[minmax(0,1.4fr)_8rem_9rem_8rem_3rem] gap-4 bg-[#edf1ed] px-4 py-3 text-[10px] font-bold uppercase tracking-[0.12em] text-[#65736d] dark:bg-dark-tertiary dark:text-dark-text-secondary md:grid">
                <span>Member</span>
                <span>Role</span>
                <span>Access</span>
                <span>Joined</span>
                <span />
              </div>
              <div className="divide-y divide-[#e6ebe7] dark:divide-dark-border">
                {filtered.map((member) => {
                  const canManageTarget =
                    member.userId !== currentUserId &&
                    roleRank[currentUserRole] > roleRank[member.role];
                  return (
                    <MemberCard
                      key={member.id}
                      member={member}
                      isCurrentUser={member.userId === currentUserId}
                      canChangeRole={canManageTarget}
                      canEditPermissions={
                        currentUserRole === "owner" && member.role !== "owner"
                      }
                      canRemove={canManageTarget}
                      isMenuOpen={menuOpenFor === member.id}
                      onMenuToggle={() =>
                        setMenuOpenFor(
                          menuOpenFor === member.id ? null : member.id,
                        )
                      }
                      onRoleChange={(role) =>
                        void handleRoleChange(member.userId, role)
                      }
                      onEditPermissions={() => {
                        setPermissionMember(member);
                        setMenuOpenFor(null);
                      }}
                      onRemove={() => {
                        setPendingRemove(member.userId);
                        setMenuOpenFor(null);
                      }}
                    />
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-[#cbd6cf] py-12 text-center text-sm text-[#65736d] dark:border-dark-border dark:text-dark-text-secondary">
              No members match your filters.
            </div>
          )}

          <MemberPermissionsDialog
            member={permissionMember}
            isSaving={updatePermissions.isPending || resetPermissions.isPending}
            error={updatePermissions.error || resetPermissions.error}
            onClose={() => setPermissionMember(null)}
            onSave={handlePermissionsSave}
            onReset={handlePermissionsReset}
          />
          <ConfirmationDialog
            open={pendingRemove !== null}
            onOpenChange={(open) => !open && setPendingRemove(null)}
            title="Remove team member"
            description="This member will immediately lose access to workspace conversations and data."
            confirmText="Remove member"
            isDestructive
            isLoading={removeMember.isPending}
            onConfirm={handleConfirmRemove}
          />
        </>
      );
    },
  });
}
