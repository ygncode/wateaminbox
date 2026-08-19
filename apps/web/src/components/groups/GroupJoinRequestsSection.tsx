import { Check, Loader2, RefreshCw, UserPlus, X } from "lucide-react";
import { RightPanelSection } from "@/components/layout/right-panel";
import { Button } from "@/components/ui/button";
import {
  type GroupDetail,
  useDecideJoinRequests,
  useGroupJoinRequests,
  useRefreshJoinRequests,
} from "@/hooks/useGroups";
import { formatPhoneLikeText } from "@/lib/utils";
import { useTranslation } from "react-i18next";

interface GroupJoinRequestsSectionProps {
  group: GroupDetail;
}

/**
 * Pending requests to join the group.
 *
 * Only meaningful when the group requires approval, and only visible to admins
 * - the same audience WhatsApp exposes the list to. The list is a cache of the
 * last fetch, so the refresh control is part of the feature rather than a
 * convenience.
 */
export function GroupJoinRequestsSection({
  group,
}: GroupJoinRequestsSectionProps) {
  const { t } = useTranslation();

  const enabled = group.isAdmin && group.isMember;
  const { data, isLoading } = useGroupJoinRequests(group.id, enabled);
  const refresh = useRefreshJoinRequests();
  const decide = useDecideJoinRequests();

  if (!enabled) return null;

  const requests = data?.requests ?? [];
  const busy = decide.isPending || refresh.isPending;

  return (
    <RightPanelSection
      title={`Join requests${requests.length > 0 ? ` · ${requests.length}` : ""}`}
    >
      {!group.settings.isJoinApprovalRequired && (
        <p className="mb-3 text-xs text-gray-500 dark:text-dark-text-tertiary">
          {t(
            "groups.approvalOffHint",
            "Approval is currently off, so people who use the invite link join straight away. Requests made before it was turned off still appear here.",
          )}
        </p>
      )}

      {isLoading ? (
        <p className="text-sm text-gray-500 dark:text-dark-text-secondary">
          {t("groups.loadingJoinRequests", "Loading join requests…")}
        </p>
      ) : requests.length === 0 ? (
        <div className="flex gap-3 rounded-lg bg-gray-50 p-3 dark:bg-dark-elevated">
          <UserPlus className="mt-0.5 h-5 w-5 shrink-0 text-gray-400" />
          <p className="text-sm leading-5 text-gray-600 dark:text-dark-text-secondary">
            {/* "Never asked" and "asked, nobody waiting" are different facts,
                and saying the second when the first is true would be wrong. */}
            {data?.syncedAt
              ? t(
                  "groups.noJoinRequests",
                  "Nobody is waiting to join. Refresh to check WhatsApp again.",
                )
              : t(
                  "groups.joinRequestsNotFetched",
                  "Join requests have not been fetched yet. Refresh to ask WhatsApp.",
                )}
          </p>
        </div>
      ) : (
        <ul className="-mx-2 space-y-0.5">
          {requests.map((request) => (
            <li
              key={request.jid}
              className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-2 hover:bg-gray-50 dark:hover:bg-dark-elevated"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900 dark:text-dark-text-primary">
                  {formatPhoneLikeText(request.jid)}
                </p>
                {request.requestedAt && (
                  <p className="truncate text-xs text-gray-500 dark:text-dark-text-tertiary">
                    Requested {new Date(request.requestedAt).toLocaleString()}
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1"
                disabled={busy || !group.canAdminister}
                onClick={() =>
                  decide.mutate({
                    groupId: group.id,
                    requesterJids: [request.jid],
                    decision: "approve",
                  })
                }
              >
                <Check className="h-3.5 w-3.5" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1"
                disabled={busy || !group.canAdminister}
                onClick={() =>
                  decide.mutate({
                    groupId: group.id,
                    requesterJids: [request.jid],
                    decision: "reject",
                  })
                }
              >
                <X className="h-3.5 w-3.5" />
                Reject
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Button
        size="sm"
        variant="outline"
        className="mt-3 gap-1.5"
        disabled={busy || !group.canAdminister}
        onClick={() => refresh.mutate({ groupId: group.id })}
      >
        {refresh.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="h-4 w-4" />
        )}
        Refresh from WhatsApp
      </Button>
    </RightPanelSection>
  );
}
