import type { ColumnDef, PaginationState } from "@tanstack/react-table";
import { dayjs, nowMs, type CompanyInvitation } from "@wateaminbox/shared";
import { Clock, Mail, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Badge,
  ConfirmationDialog,
  EllipsisMenu,
  ServerDataTable,
} from "@/components/ui";
import type { EllipsisMenuItem } from "@/components/ui/ellipsis-menu";
import {
  useCancelInvitation,
  usePendingInvitations,
  useResendInvitation,
} from "@/hooks/useTeam";
import type { InvitationsListProps } from "./types";

export function InvitationsList({ companyId }: InvitationsListProps) {
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  });
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "admin" | "member">(
    "all",
  );
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);
  const [pendingCancel, setPendingCancel] = useState<string | null>(null);
  const invitationsQuery = usePendingInvitations(companyId, {
    search,
    role: roleFilter,
    limit: pagination.pageSize,
    offset: pagination.pageIndex * pagination.pageSize,
  });
  const cancelInvitation = useCancelInvitation();
  const resendInvitation = useResendInvitation();

  useEffect(() => {
    setPagination((current) =>
      current.pageIndex === 0 ? current : { ...current, pageIndex: 0 },
    );
  }, [roleFilter, search]);

  const handleCancel = async () => {
    if (!pendingCancel) return;
    try {
      await cancelInvitation.mutateAsync({
        companyId,
        invitationId: pendingCancel,
      });
      setPendingCancel(null);
    } catch {
      // Keep the dialog open so the mutation error remains visible.
    }
  };

  const handleResend = async (invitationId: string) => {
    try {
      await resendInvitation.mutateAsync({ companyId, invitationId });
    } catch {
      // React Query exposes the error in the action banner below.
    }
  };

  const columns: ColumnDef<CompanyInvitation>[] = [
    {
      id: "invitee",
      header: "Invitee",
      size: 320,
      cell: ({ row }) => {
        const invitation = row.original;
        return (
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#dcefe7] text-[#075c41] dark:bg-emerald-950/60 dark:text-emerald-300">
              <Mail className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate font-semibold text-[#20362e] dark:text-dark-text-primary">
                {invitation.email}
              </p>
              <p className="truncate text-xs text-[#718078] dark:text-dark-text-secondary">
                Sent {dayjs(invitation.createdAt).format("MMM D, YYYY")} ·{" "}
                {invitation.deliveryState || "delivered"}
              </p>
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "role",
      header: "Role",
      size: 110,
      cell: ({ row }) => (
        <Badge variant="secondary" className="capitalize">
          {row.original.role}
        </Badge>
      ),
    },
    {
      id: "access",
      header: "Access",
      size: 150,
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
      id: "invitedBy",
      header: "Invited by",
      size: 190,
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[#31463e] dark:text-dark-text-primary">
            {row.original.inviterName ||
              row.original.inviterEmail ||
              "Team member"}
          </p>
          {row.original.inviterName && row.original.inviterEmail && (
            <p className="truncate text-xs text-[#718078] dark:text-dark-text-secondary">
              {row.original.inviterEmail}
            </p>
          )}
        </div>
      ),
    },
    {
      accessorKey: "expiresAt",
      header: "Expires",
      size: 170,
      cell: ({ row }) => {
        const expiresAt = dayjs(row.original.expiresAt);
        const isExpiringSoon =
          expiresAt.valueOf() - nowMs() < 24 * 60 * 60 * 1000;
        return (
          <time
            dateTime={row.original.expiresAt}
            className={
              isExpiringSoon
                ? "inline-flex items-center gap-1.5 font-mono text-xs text-orange-600 dark:text-orange-400"
                : "inline-flex items-center gap-1.5 font-mono text-xs text-[#65736d] dark:text-dark-text-secondary"
            }
          >
            <Clock className="h-3.5 w-3.5" />
            {expiresAt.format("MMM D, YYYY")}
          </time>
        );
      },
    },
    {
      id: "actions",
      header: "",
      size: 56,
      cell: ({ row }) => {
        const invitation = row.original;
        const isResending =
          resendInvitation.isPending &&
          resendInvitation.variables?.invitationId === invitation.id;
        const isCancelling =
          cancelInvitation.isPending && pendingCancel === invitation.id;
        const items: EllipsisMenuItem[] = [
          {
            id: "resend",
            label: isResending ? "Resending…" : "Resend invitation",
            icon: RefreshCw,
            disabled: resendInvitation.isPending || cancelInvitation.isPending,
            onClick: () => void handleResend(invitation.id),
          },
          {
            id: "cancel",
            label: isCancelling ? "Cancelling…" : "Cancel invitation",
            icon: X,
            destructive: true,
            disabled: resendInvitation.isPending || cancelInvitation.isPending,
            onClick: () => setPendingCancel(invitation.id),
          },
        ];

        return (
          <EllipsisMenu
            items={items}
            ariaLabel={`Actions for ${invitation.email}`}
            open={menuOpenFor === invitation.id}
            onOpenChange={(open) => setMenuOpenFor(open ? invitation.id : null)}
          />
        );
      },
    },
  ];

  const actionError = cancelInvitation.error || resendInvitation.error;
  const page = invitationsQuery.data;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {actionError && (
        <div
          role="alert"
          className="shrink-0 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300"
        >
          {actionError.message || "Could not update this invitation"}
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
          onChange: setSearch,
          placeholder: "Search invitee or inviter…",
          label: "Search pending invitations",
        }}
        toolbarActions={
          <label className="flex items-center gap-2 text-xs font-medium text-[#65736d] dark:text-dark-text-secondary">
            <span className="hidden sm:inline">Role</span>
            <select
              value={roleFilter}
              onChange={(event) =>
                setRoleFilter(event.target.value as "all" | "admin" | "member")
              }
              className="h-9 rounded-lg border border-[#d7e0da] bg-white px-3 text-sm text-[#263b33] shadow-none dark:border-dark-border dark:bg-dark-tertiary dark:text-dark-text-primary"
              aria-label="Filter invitations by role"
            >
              <option value="all">All roles</option>
              <option value="admin">Admins</option>
              <option value="member">Members</option>
            </select>
          </label>
        }
        isLoading={invitationsQuery.isLoading}
        isFetching={invitationsQuery.isFetching}
        error={invitationsQuery.error}
        getRowId={(invitation) => invitation.id}
        tableLabel="Pending invitations"
        emptyTitle={
          search || roleFilter !== "all"
            ? "No invitations match this view"
            : "No pending invitations"
        }
        emptyDescription={
          search || roleFilter !== "all"
            ? "Try a different search or role filter."
            : "New invitations will appear here until they are accepted or expire."
        }
        className="min-h-0 flex-1"
      />

      <ConfirmationDialog
        open={pendingCancel !== null}
        onOpenChange={(open) => !open && setPendingCancel(null)}
        title="Cancel invitation"
        description="This invitation link will stop working immediately."
        confirmText="Cancel invitation"
        onConfirm={handleCancel}
        isDestructive
        isLoading={cancelInvitation.isPending}
      />
    </div>
  );
}
