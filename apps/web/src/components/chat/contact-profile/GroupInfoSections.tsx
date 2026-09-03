import {
  Crown,
  Loader2,
  RefreshCw,
  ShieldMinus,
  ShieldPlus,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { AddParticipantsDialog } from "@/components/groups/AddParticipantsDialog";
import { GroupInviteLinkSection } from "@/components/groups/GroupInviteLinkSection";
import { GroupJoinRequestsSection } from "@/components/groups/GroupJoinRequestsSection";
import { GroupLeaveSection } from "@/components/groups/GroupLeaveSection";
import { GroupSettingsSection } from "@/components/groups/GroupSettingsSection";
import { RightPanelSection } from "@/components/layout/right-panel";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { IdentityAvatarFallback } from "@/components/ui/identity-avatar-fallback";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type GroupDetail,
  type GroupParticipant,
  useDemoteParticipants,
  usePromoteParticipants,
  useRemoveParticipants,
  useSyncGroup,
} from "@/hooks/useGroups";
import { formatPhoneLikeText, formatPhoneNumber } from "@/lib/utils";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

interface GroupInfoSectionsProps {
  group: GroupDetail | undefined;
  isLoading: boolean;
  error: Error | null;
  /** Re-points the profile panel at one member, the way WhatsApp does. */
  onOpenParticipantProfile?: (participantContactId: string) => void;
}

const INITIAL_MEMBER_LIMIT = 12;

/** A member action awaiting confirmation. */
type PendingAction = {
  kind: "promote" | "demote" | "remove";
  participant: GroupParticipant;
};

export function GroupInfoSections({
  group,
  isLoading,
  error,
  onOpenParticipantProfile,
}: GroupInfoSectionsProps) {
  const { t } = useTranslation();

  const [showAll, setShowAll] = useState(false);
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null,
  );

  const promote = usePromoteParticipants();
  const demote = useDemoteParticipants();
  const remove = useRemoveParticipants();
  const syncGroup = useSyncGroup();

  const visibleParticipants = useMemo(
    () =>
      showAll
        ? (group?.participants ?? [])
        : (group?.participants ?? []).slice(0, INITIAL_MEMBER_LIMIT),
    [group?.participants, showAll],
  );

  if (isLoading) {
    return (
      <RightPanelSection title={t("groups.participants", "Participants")}>
        <div
          className="space-y-3"
          aria-label={t(
            "groups.loadingParticipants",
            "Loading group participants",
          )}
        >
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
      <RightPanelSection title={t("groups.participants", "Participants")}>
        <p className="text-sm text-red-600 dark:text-red-400">
          {t("groups.participantsError", "Failed to load group participants.")}
        </p>
      </RightPanelSection>
    );
  }

  const canAdminister = group?.canAdminister ?? false;
  const actionPending =
    promote.isPending || demote.isPending || remove.isPending;

  const runPendingAction = async () => {
    if (!group || !pendingAction) return;
    const variables = {
      groupId: group.id,
      participantJids: [pendingAction.participant.jid],
    };
    if (pendingAction.kind === "promote") await promote.mutateAsync(variables);
    else if (pendingAction.kind === "demote")
      await demote.mutateAsync(variables);
    else await remove.mutateAsync(variables);
    setPendingAction(null);
  };

  return (
    <>
      {group?.description && (
        <RightPanelSection title={t("groups.description", "Description")}>
          <p className="whitespace-pre-wrap text-sm leading-6 text-gray-700 dark:text-dark-text-primary">
            {group.description}
          </p>
        </RightPanelSection>
      )}

      <RightPanelSection
        title={`Participants · ${group?.participantCount ?? group?.participants.length ?? 0}`}
      >
        {group && (
          <div className="mb-3 flex flex-wrap gap-2">
            {canAdminister && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => setShowAddMembers(true)}
              >
                <UserPlus className="h-4 w-4" />
                {t("groups.addMembers", "Add members")}
              </Button>
            )}
            {/* Repairs a member list that drifted while the worker was offline,
                without changing anything on WhatsApp. */}
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={
                syncGroup.isPending || group.connection?.status !== "connected"
              }
              onClick={() => syncGroup.mutate({ groupId: group.id })}
            >
              {syncGroup.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Refresh from WhatsApp
            </Button>
          </div>
        )}

        {visibleParticipants.length > 0 ? (
          <div className="-mx-2 space-y-0.5">
            {visibleParticipants.map((participant) => (
              <ParticipantRow
                key={participant.jid}
                participant={participant}
                canAdminister={canAdminister}
                busy={actionPending}
                onAction={(kind) => setPendingAction({ kind, participant })}
                onOpenProfile={onOpenParticipantProfile}
              />
            ))}
            {(group?.participants.length ?? 0) > INITIAL_MEMBER_LIMIT && (
              <button
                type="button"
                onClick={() => setShowAll((current) => !current)}
                className="mt-2 w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-whatsapp-teal-green transition-colors hover:bg-gray-50 dark:hover:bg-dark-tertiary"
              >
                {showAll
                  ? t("groups.showFewerParticipants", "Show fewer participants")
                  : t("groups.showAllParticipants", {
                      defaultValue: "Show all {{count}} participants",
                      count: group?.participants.length ?? 0,
                    })}
              </button>
            )}
          </div>
        ) : (
          <div className="flex gap-3 rounded-lg bg-gray-50 p-3 dark:bg-dark-elevated">
            <Users className="mt-0.5 h-5 w-5 shrink-0 text-gray-400" />
            <p className="text-sm leading-5 text-gray-600 dark:text-dark-text-secondary">
              {t(
                "groups.participantsSyncing",
                "Participant details are syncing from WhatsApp. They refresh when the connected account comes online.",
              )}
            </p>
          </div>
        )}
      </RightPanelSection>

      {group && (
        <>
          <GroupSettingsSection group={group} />
          <GroupInviteLinkSection group={group} />
          <GroupJoinRequestsSection group={group} />
          <GroupLeaveSection group={group} />

          <AddParticipantsDialog
            group={group}
            open={showAddMembers}
            onOpenChange={setShowAddMembers}
          />

          <ConfirmationDialog
            open={pendingAction !== null}
            onOpenChange={(open) => {
              if (!open) setPendingAction(null);
            }}
            title={pendingActionTitle(t, pendingAction)}
            description={pendingActionDescription(t, pendingAction)}
            confirmText={pendingActionConfirm(t, pendingAction)}
            isDestructive={pendingAction?.kind === "remove"}
            isLoading={actionPending}
            onConfirm={runPendingAction}
          />
        </>
      )}
    </>
  );
}

function pendingActionTitle(
  t: TFunction,
  action: PendingAction | null,
): string {
  if (!action) return "";
  const name = formatPhoneLikeText(action.participant.displayName);
  if (action.kind === "promote")
    return t("groups.promoteTitle", {
      defaultValue: "Make {{name}} an admin?",
      name,
    });
  if (action.kind === "demote")
    return t("groups.demoteTitle", {
      defaultValue: "Remove {{name}}'s admin rights?",
      name,
    });
  return t("groups.removeTitle", {
    defaultValue: "Remove {{name}} from the group?",
    name,
  });
}

function pendingActionDescription(
  t: TFunction,
  action: PendingAction | null,
): string {
  if (!action) return "";
  const name = formatPhoneLikeText(action.participant.displayName);
  if (action.kind === "promote") {
    return t("groups.promoteDescription", {
      defaultValue:
        "{{name}} will be able to add and remove members, change group settings and manage the invite link. WhatsApp applies the change; it appears here once confirmed.",
      name,
    });
  }
  if (action.kind === "demote") {
    return t("groups.demoteDescription", {
      defaultValue:
        "{{name}} stays in the group as a regular member and loses admin rights. WhatsApp applies the change; it appears here once confirmed.",
      name,
    });
  }
  return t("groups.removeDescription", {
    defaultValue:
      "{{name}} is removed from the group and stops receiving its messages. They can rejoin only with a new invite. WhatsApp applies the change; it appears here once confirmed.",
    name,
  });
}

function pendingActionConfirm(
  t: TFunction,
  action: PendingAction | null,
): string {
  if (action?.kind === "promote") return t("groups.makeAdmin", "Make admin");
  if (action?.kind === "demote") return t("groups.removeAdmin", "Remove admin");
  return t("groups.removeMember", "Remove member");
}

interface ParticipantRowProps {
  participant: GroupParticipant;
  canAdminister: boolean;
  busy: boolean;
  onAction: (kind: PendingAction["kind"]) => void;
  /** Absent, or absent for this member, leaves the row as static text. */
  onOpenProfile?: (participantContactId: string) => void;
}

function ParticipantRow({
  participant,
  canAdminister,
  busy,
  onAction,
  onOpenProfile,
}: ParticipantRowProps) {
  const { t } = useTranslation();

  const displayName = formatPhoneLikeText(participant.displayName);
  const phone = participant.phoneNumber
    ? formatPhoneNumber(participant.phoneNumber)
    : null;
  // Acting on this account's own membership belongs in the leave control, which
  // states what leaving does; offering "remove" here would bypass that wording.
  const showActions = canAdminister && !participant.isSelf;
  // A member the workspace holds no contact record for has no profile to open,
  // so their row stays inert rather than becoming a dead control.
  const profileContactId = participant.contactId ?? null;
  const canOpenProfile = Boolean(profileContactId && onOpenProfile);

  const identity = (
    <>
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
    </>
  );

  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg px-2 py-2 hover:bg-gray-50 dark:hover:bg-dark-elevated">
      {canOpenProfile && profileContactId ? (
        // The admin controls to the right are buttons of their own, so the
        // identity is its own control rather than the whole row - nesting them
        // would be invalid and would make the row's action ambiguous.
        <button
          type="button"
          onClick={() => onOpenProfile?.(profileContactId)}
          aria-label={t("groups.openParticipantProfile", {
            defaultValue: "Open {{name}}'s contact info",
            name: displayName,
          })}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-whatsapp-green/50"
        >
          {identity}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3">{identity}</div>
      )}
      {participant.isAdmin && (
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
          <Crown className="h-3 w-3" />
          Admin
        </span>
      )}
      {showActions && (
        <div className="flex shrink-0 items-center gap-0.5">
          <IconAction
            label={
              participant.isAdmin
                ? `Remove ${displayName}'s admin rights`
                : `Make ${displayName} an admin`
            }
            busy={busy}
            onClick={() => onAction(participant.isAdmin ? "demote" : "promote")}
          >
            {participant.isAdmin ? (
              <ShieldMinus className="h-4 w-4" />
            ) : (
              <ShieldPlus className="h-4 w-4" />
            )}
          </IconAction>
          <IconAction
            label={`Remove ${displayName} from the group`}
            busy={busy}
            destructive
            onClick={() => onAction("remove")}
          >
            <UserMinus className="h-4 w-4" />
          </IconAction>
        </div>
      )}
    </div>
  );
}

function IconAction({
  label,
  busy,
  destructive,
  onClick,
  children,
}: {
  label: string;
  busy: boolean;
  destructive?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={busy}
      onClick={onClick}
      className={
        destructive
          ? "grid size-8 place-items-center rounded-lg text-red-600 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/40"
          : "grid size-8 place-items-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-whatsapp-green/40 disabled:cursor-not-allowed disabled:opacity-50 dark:text-dark-text-tertiary dark:hover:bg-dark-tertiary"
      }
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : children}
    </button>
  );
}
