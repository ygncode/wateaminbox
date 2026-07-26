import { Mail } from "lucide-react";
import { useState } from "react";
import { ConfirmationDialog } from "@/components/ui";
import { useAsyncData } from "@/hooks/useAsyncData";
import {
  useCancelInvitation,
  usePendingInvitations,
  useResendInvitation,
} from "@/hooks/useTeam";
import { InvitationCard } from "./InvitationCard";
import { MemberSkeleton } from "./MemberSkeleton";
import type { InvitationsListProps } from "./types";

/**
 * Invitations list component
 */
export function InvitationsList({
  companyId,
  search = "",
}: InvitationsListProps) {
  const { renderState } = useAsyncData(usePendingInvitations(companyId));
  const cancelInvitation = useCancelInvitation();
  const resendInvitation = useResendInvitation();
  const actionError = cancelInvitation.error || resendInvitation.error;
  const [pendingCancel, setPendingCancel] = useState<string | null>(null);

  const handleCancel = async () => {
    if (!pendingCancel) return;
    try {
      await cancelInvitation.mutateAsync({
        companyId,
        invitationId: pendingCancel,
      });
      setPendingCancel(null);
    } catch {
      // React Query exposes the error in the action banner below.
    }
  };

  const handleResend = async (invitationId: string) => {
    try {
      await resendInvitation.mutateAsync({ companyId, invitationId });
    } catch {
      // React Query exposes the error in the action banner below.
    }
  };

  return renderState({
    loading: () => (
      <div className="space-y-4">
        {[1, 2].map((i) => (
          <MemberSkeleton key={i} />
        ))}
      </div>
    ),
    error: () => (
      <div className="text-center text-red-500 dark:text-red-400">
        Failed to load invitations
      </div>
    ),
    empty: () => (
      <div className="text-center text-gray-500 dark:text-dark-text-secondary py-8">
        <Mail className="mx-auto h-12 w-12 text-gray-300 dark:text-dark-text-tertiary" />
        <p className="mt-2">No pending invitations</p>
      </div>
    ),
    success: (invitations) => (
      <div className="space-y-2">
        {actionError && (
          <div
            role="alert"
            className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300"
          >
            {actionError.message || "Could not update this invitation"}
          </div>
        )}
        {invitations
          .filter((invitation) =>
            invitation.email
              .toLocaleLowerCase()
              .includes(search.trim().toLocaleLowerCase()),
          )
          .map((invitation) => (
            <InvitationCard
              key={invitation.id}
              invitation={invitation}
              onCancel={() => setPendingCancel(invitation.id)}
              onResend={() => handleResend(invitation.id)}
              isCancelling={cancelInvitation.isPending}
              isResending={resendInvitation.isPending}
            />
          ))}
        {invitations.length > 0 &&
          !invitations.some((invitation) =>
            invitation.email
              .toLocaleLowerCase()
              .includes(search.trim().toLocaleLowerCase()),
          ) && (
            <div className="rounded-xl border border-dashed border-[#cbd6cf] py-12 text-center text-sm text-[#65736d] dark:border-dark-border dark:text-dark-text-secondary">
              No invitations match your search.
            </div>
          )}
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
    ),
  });
}
