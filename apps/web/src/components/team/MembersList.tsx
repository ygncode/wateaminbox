import type { ColumnDef, PaginationState } from "@tanstack/react-table";
import type { CompanyMember, MemberPermissions } from "@wateaminbox/shared";
import { Crown, Settings2, Shield, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Avatar,
  AvatarFallback,
  Badge,
  ConfirmationDialog,
  EllipsisMenu,
  ServerDataTable,
} from "@/components/ui";
import type { EllipsisMenuItem } from "@/components/ui/ellipsis-menu";
import {
  useCompanyMembers,
  useRemoveMember,
  useResetMemberPermissions,
  useUpdateMemberPermissions,
  useUpdateMemberRole,
} from "@/hooks/useTeam";
import { MemberPermissionsDialog } from "./MemberPermissionsDialog";
import type { MembersListProps } from "./types";

const roleRank = { owner: 3, admin: 2, member: 1 } as const;

export function MembersList({
  companyId,
  currentUserId,
  currentUserRole,
  search,
  roleFilter,
  onSearchChange,
  onRoleFilterChange,
}: MembersListProps) {
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  });
  const membersQuery = useCompanyMembers(companyId, {
    search,
    role: roleFilter,
    limit: pagination.pageSize,
    offset: pagination.pageIndex * pagination.pageSize,
  });
  const updateRole = useUpdateMemberRole();
  const updatePermissions = useUpdateMemberPermissions();
  const resetPermissions = useResetMemberPermissions();
  const removeMember = useRemoveMember();
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const [permissionMember, setPermissionMember] =
    useState<CompanyMember | null>(null);

  useEffect(() => {
    setPagination((current) =>
      current.pageIndex === 0 ? current : { ...current, pageIndex: 0 },
    );
  }, [roleFilter, search]);

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

  const columns: ColumnDef<CompanyMember>[] = [
    {
      id: "member",
      header: "Member",
      size: 330,
      cell: ({ row }) => (
        <MemberIdentity
          member={row.original}
          isCurrentUser={row.original.userId === currentUserId}
        />
      ),
    },
    {
      accessorKey: "role",
      header: "Role",
      size: 130,
      cell: ({ row }) => <MemberRole role={row.original.role} />,
    },
    {
      id: "access",
      header: "Access",
      size: 160,
      cell: ({ row }) => {
        const hasCustomAccess = Boolean(
          row.original.permissions &&
            Object.keys(row.original.permissions).length,
        );
        return (
          <Badge
            variant={hasCustomAccess ? "default" : "secondary"}
            className="text-[10px]"
          >
            {hasCustomAccess ? "Custom access" : "Role defaults"}
          </Badge>
        );
      },
    },
    {
      accessorKey: "joinedAt",
      header: "Joined",
      size: 150,
      cell: ({ row }) => (
        <time className="font-mono text-xs text-[#65736d] dark:text-dark-text-secondary">
          {new Date(row.original.joinedAt).toLocaleDateString()}
        </time>
      ),
    },
    {
      id: "actions",
      header: "",
      size: 56,
      cell: ({ row }) => {
        const member = row.original;
        const canManageTarget =
          member.userId !== currentUserId &&
          roleRank[currentUserRole] > roleRank[member.role];
        const canEditPermissions =
          currentUserRole === "owner" && member.role !== "owner";
        const items: EllipsisMenuItem[] = [];

        if (canManageTarget && member.role === "member") {
          items.push({
            id: "make-admin",
            label: "Make admin",
            icon: ShieldCheck,
            onClick: () => void handleRoleChange(member.userId, "admin"),
          });
        }
        if (canManageTarget && member.role === "admin") {
          items.push({
            id: "make-member",
            label: "Make member",
            icon: Shield,
            onClick: () => void handleRoleChange(member.userId, "member"),
          });
        }
        if (canEditPermissions) {
          items.push({
            id: "permissions",
            label: "Edit access",
            icon: Settings2,
            onClick: () => {
              setPermissionMember(member);
              setMenuOpenFor(null);
            },
          });
        }
        if (canManageTarget) {
          items.push({
            id: "remove",
            label: "Remove member",
            icon: Trash2,
            destructive: true,
            onClick: () => {
              setPendingRemove(member.userId);
              setMenuOpenFor(null);
            },
          });
        }

        return items.length ? (
          <EllipsisMenu
            items={items}
            ariaLabel={`Actions for ${member.name || member.email}`}
            open={menuOpenFor === member.id}
            onOpenChange={(open) => setMenuOpenFor(open ? member.id : null)}
          />
        ) : null;
      },
    },
  ];

  const actionError =
    updateRole.error ||
    updatePermissions.error ||
    resetPermissions.error ||
    removeMember.error;
  const page = membersQuery.data;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {actionError && (
        <div
          role="alert"
          className="shrink-0 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300"
        >
          {actionError.message || "Could not update this team member"}
        </div>
      )}

      <ServerDataTable
        columns={columns}
        data={page?.data ?? []}
        rowCount={page?.pagination.total ?? 0}
        pagination={pagination}
        onPaginationChange={setPagination}
        search={{
          value: search,
          onChange: onSearchChange,
          placeholder: "Search by name or email…",
          label: "Search team members",
        }}
        toolbarActions={
          <label className="flex items-center gap-2 text-xs font-medium text-[#65736d] dark:text-dark-text-secondary">
            <span className="hidden sm:inline">Role</span>
            <select
              value={roleFilter}
              onChange={(event) =>
                onRoleFilterChange(
                  event.target.value as MembersListProps["roleFilter"],
                )
              }
              className="h-9 rounded-lg border border-[#d7e0da] bg-white px-3 text-sm text-[#263b33] shadow-none dark:border-dark-border dark:bg-dark-tertiary dark:text-dark-text-primary"
              aria-label="Filter members by role"
            >
              <option value="all">All roles</option>
              <option value="owner">Owners</option>
              <option value="admin">Admins</option>
              <option value="member">Members</option>
            </select>
          </label>
        }
        isLoading={membersQuery.isLoading}
        isFetching={membersQuery.isFetching}
        error={membersQuery.error}
        getRowId={(member) => member.id}
        tableLabel="Workspace members"
        emptyTitle={
          search || roleFilter !== "all"
            ? "No members match this view"
            : "No team members yet"
        }
        emptyDescription={
          search || roleFilter !== "all"
            ? "Try a different search or role filter."
            : "Invite someone to start collaborating in this workspace."
        }
        className="min-h-0 flex-1"
      />

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
    </div>
  );
}

function MemberIdentity({
  member,
  isCurrentUser,
}: {
  member: CompanyMember;
  isCurrentUser: boolean;
}) {
  const displayName = member.name || member.email;
  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar className="h-9 w-9 shrink-0">
        <AvatarFallback className="bg-[#dcefe7] text-xs font-bold text-[#075c41]">
          {initials}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate font-semibold text-[#20362e] dark:text-dark-text-primary">
            {displayName}
          </p>
          {isCurrentUser && (
            <Badge variant="outline" className="text-[9px]">
              You
            </Badge>
          )}
        </div>
        {member.name && (
          <p className="truncate text-xs text-[#718078] dark:text-dark-text-secondary">
            {member.email}
          </p>
        )}
      </div>
    </div>
  );
}

function MemberRole({ role }: { role: CompanyMember["role"] }) {
  const Icon =
    role === "owner" ? Crown : role === "admin" ? ShieldCheck : Shield;
  return (
    <span className="inline-flex items-center gap-1.5 capitalize">
      <Icon className="h-3.5 w-3.5 text-[#65736d]" />
      {role}
    </span>
  );
}
