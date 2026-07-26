import { Crown, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { RightPanelSection } from "@/components/layout/right-panel";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { IdentityAvatarFallback } from "@/components/ui/identity-avatar-fallback";
import { Skeleton } from "@/components/ui/skeleton";
import type { GroupDetail, GroupParticipant } from "@/hooks/useGroups";
import { formatPhoneLikeText, formatPhoneNumber } from "@/lib/utils";

interface GroupInfoSectionsProps {
  group: GroupDetail | undefined;
  isLoading: boolean;
  error: Error | null;
}

const INITIAL_MEMBER_LIMIT = 12;

export function GroupInfoSections({
  group,
  isLoading,
  error,
}: GroupInfoSectionsProps) {
  const [showAll, setShowAll] = useState(false);
  const visibleParticipants = useMemo(
    () =>
      showAll
        ? (group?.participants ?? [])
        : (group?.participants ?? []).slice(0, INITIAL_MEMBER_LIMIT),
    [group?.participants, showAll],
  );

  if (isLoading) {
    return (
      <RightPanelSection title="Participants">
        <div className="space-y-3" aria-label="Loading group participants">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          ))}
        </div>
      </RightPanelSection>
    );
  }

  if (error) {
    return (
      <RightPanelSection title="Participants">
        <p className="text-sm text-red-600 dark:text-red-400">
          Failed to load group participants.
        </p>
      </RightPanelSection>
    );
  }

  return (
    <>
      {group?.description && (
        <RightPanelSection title="Description">
          <p className="whitespace-pre-wrap text-sm leading-6 text-gray-700 dark:text-dark-text-primary">
            {group.description}
          </p>
        </RightPanelSection>
      )}

      <RightPanelSection
        title={`Participants · ${group?.participantCount ?? group?.participants.length ?? 0}`}
      >
        {visibleParticipants.length > 0 ? (
          <div className="-mx-2 space-y-0.5">
            {visibleParticipants.map((participant) => (
              <ParticipantRow key={participant.jid} participant={participant} />
            ))}
            {(group?.participants.length ?? 0) > INITIAL_MEMBER_LIMIT && (
              <button
                type="button"
                onClick={() => setShowAll((current) => !current)}
                className="mt-2 w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-whatsapp-teal-green transition-colors hover:bg-gray-50 dark:hover:bg-dark-tertiary"
              >
                {showAll
                  ? "Show fewer participants"
                  : `Show all ${group?.participants.length} participants`}
              </button>
            )}
          </div>
        ) : (
          <div className="flex gap-3 rounded-lg bg-gray-50 p-3 dark:bg-dark-elevated">
            <Users className="mt-0.5 h-5 w-5 shrink-0 text-gray-400" />
            <p className="text-sm leading-5 text-gray-600 dark:text-dark-text-secondary">
              Participant details are syncing from WhatsApp. They refresh when
              the connected account comes online.
            </p>
          </div>
        )}
      </RightPanelSection>
    </>
  );
}

function ParticipantRow({ participant }: { participant: GroupParticipant }) {
  const displayName = formatPhoneLikeText(participant.displayName);
  const phone = participant.phoneNumber
    ? formatPhoneNumber(participant.phoneNumber)
    : null;

  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg px-2 py-2 hover:bg-gray-50 dark:hover:bg-dark-elevated">
      <Avatar className="h-10 w-10">
        <AvatarImage
          src={participant.profilePictureUrl || undefined}
          alt={displayName}
        />
        <AvatarFallback className="p-0">
          <IdentityAvatarFallback
            displayName={displayName}
            identity={participant.jid}
            className="text-sm"
          />
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-medium text-gray-900 dark:text-dark-text-primary">
            {displayName}
          </p>
          {participant.isSelf && (
            <span className="shrink-0 text-xs text-whatsapp-teal-green">
              You
            </span>
          )}
        </div>
        <p className="truncate text-xs text-gray-500 dark:text-dark-text-tertiary">
          {phone || formatPhoneLikeText(participant.jid)}
        </p>
      </div>
      {participant.isAdmin && (
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
          <Crown className="h-3 w-3" />
          Admin
        </span>
      )}
    </div>
  );
}
