import { LogOut } from "lucide-react";
import { useState } from "react";
import { RightPanelSection } from "@/components/layout/right-panel";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { type GroupDetail, useLeaveGroup } from "@/hooks/useGroups";
import { useTranslation } from "react-i18next";

interface GroupLeaveSectionProps {
  group: GroupDetail;
}

/**
 * Leave the group.
 *
 * Deliberately NOT presented as deleting or disbanding the group: WhatsApp has
 * no such operation. The copy states plainly that the group continues without
 * this account, so nobody reaches for this expecting it to remove the group for
 * everyone.
 */
export function GroupLeaveSection({ group }: GroupLeaveSectionProps) {
  const { t } = useTranslation();

  const leaveGroup = useLeaveGroup();
  const [confirming, setConfirming] = useState(false);

  return (
    <RightPanelSection title={t("groups.membership", "Membership")}>
      {group.isMember ? (
        <>
          <p className="text-sm leading-5 text-gray-600 dark:text-dark-text-secondary">
            {group.leaveSemantics}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-3 gap-1.5 text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40"
            disabled={
              leaveGroup.isPending || group.connection?.status !== "connected"
            }
            onClick={() => setConfirming(true)}
          >
            <LogOut className="h-4 w-4" />
            {t("groups.leaveGroup", "Leave group")}
          </Button>
          {group.connection?.status !== "connected" && (
            <p className="mt-2 text-xs text-gray-500 dark:text-dark-text-tertiary">
              {t(
                "groups.leaveOfflineHint",
                "The WhatsApp account for this group is offline. Reconnect it to leave.",
              )}
            </p>
          )}
        </>
      ) : (
        <p className="text-sm leading-5 text-gray-600 dark:text-dark-text-secondary">
          {t(
            "groups.alreadyLeftHint",
            "This WhatsApp account has left the group. The conversation stays here as a record, and the group continues for its other members.",
          )}
        </p>
      )}

      <ConfirmationDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("groups.leaveConfirm", "Leave this group?")}
        description={`${group.displayName}: this WhatsApp account stops receiving and sending messages here. ${group.leaveSemantics} Rejoining needs a new invite.`}
        confirmText={t("groups.leaveGroup", "Leave group")}
        isDestructive
        isLoading={leaveGroup.isPending}
        onConfirm={async () => {
          // Only dismiss once the request was accepted; a refusal keeps the
          // dialog up with the toast explaining why.
          await leaveGroup.mutateAsync({ groupId: group.id });
          setConfirming(false);
        }}
      />
    </RightPanelSection>
  );
}
