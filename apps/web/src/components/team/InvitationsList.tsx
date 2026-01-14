import { Mail } from "lucide-react";
import { useAsyncData } from "@/hooks";
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

  const handleCancel = async (invitationId: string) => {
    if (confirm("Are you sure you want to cancel this invitation?")) {
      await cancelInvitation.mutateAsync({ companyId, invitationId });
    }
  };

  const handleResend = async (invitationId: string) => {
    await resendInvitation.mutateAsync({ companyId, invitationId });
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
