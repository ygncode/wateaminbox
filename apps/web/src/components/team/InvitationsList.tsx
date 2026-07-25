import { Mail } from "lucide-react";
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
export function InvitationsList({ companyId }: InvitationsListProps) {
  const { renderState } = useAsyncData(usePendingInvitations(companyId));
  const cancelInvitation = useCancelInvitation();
  const resendInvitation = useResendInvitation();
  const actionError = cancelInvitation.error || resendInvitation.error;

  const handleCancel = async (invitationId: string) => {
    if (!confirm("Are you sure you want to cancel this invitation?")) return;
    try {
      await cancelInvitation.mutateAsync({ companyId, invitationId });
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
        {invitations.map((invitation) => (
          <InvitationCard
            key={invitation.id}
            invitation={invitation}
            onCancel={() => handleCancel(invitation.id)}
            onResend={() => handleResend(invitation.id)}
            isCancelling={cancelInvitation.isPending}
            isResending={resendInvitation.isPending}
          />
        ))}
      </div>
    ),
  });
}
