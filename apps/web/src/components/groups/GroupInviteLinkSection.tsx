import { Check, Copy, Link2, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { RightPanelSection } from "@/components/layout/right-panel";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { type GroupDetail, useGroupInviteLink } from "@/hooks/useGroups";
import { useTranslation } from "react-i18next";

interface GroupInviteLinkSectionProps {
  group: GroupDetail;
}

/**
 * The group's invite link.
 *
 * WhatsApp only issues the link on request and only to admins, so there is
 * nothing to show until it has been fetched at least once. Resetting is behind
 * a confirmation because it invalidates every copy of the link already shared.
 */
export function GroupInviteLinkSection({ group }: GroupInviteLinkSectionProps) {
  const { t } = useTranslation();

  const inviteLink = useGroupInviteLink();
  const [copied, setCopied] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  if (!group.isAdmin || !group.isMember) return null;

  const disabled = !group.canAdminister || inviteLink.isPending;

  const copy = async () => {
    if (!group.inviteLink) return;
    try {
      await navigator.clipboard.writeText(group.inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(
        t("groups.copyFailed", "Could not copy the link to the clipboard"),
      );
    }
  };

  return (
    <RightPanelSection title={t("groups.inviteLink", "Invite link")}>
      {group.inviteLink ? (
        <div className="space-y-2">
          <p className="break-all rounded-lg bg-gray-50 p-2.5 font-mono text-xs text-gray-700 dark:bg-dark-elevated dark:text-dark-text-primary">
            {group.inviteLink}
          </p>
          <p className="text-xs text-gray-500 dark:text-dark-text-tertiary">
            {t(
              "groups.inviteLinkHint",
              "Anyone with this link can request to join. Treat it like a password.",
            )}
          </p>
        </div>
      ) : (
        <div className="flex gap-3 rounded-lg bg-gray-50 p-3 dark:bg-dark-elevated">
          <Link2 className="mt-0.5 h-5 w-5 shrink-0 text-gray-400" />
          <p className="text-sm leading-5 text-gray-600 dark:text-dark-text-secondary">
            {t(
              "groups.inviteLinkFetchHint",
              "WhatsApp hands out the invite link on request. Fetch it to see it here.",
            )}
          </p>
        </div>
      )}

      {/* The copy confirmation is otherwise a purely visual state change. */}
      <p className="sr-only" role="status" aria-live="polite">
        {copied
          ? t("groups.linkCopied", "Invite link copied to the clipboard")
          : ""}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={disabled}
          onClick={() => inviteLink.mutate({ groupId: group.id, reset: false })}
        >
          {inviteLink.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {group.inviteLink ? "Refresh" : t("groups.getLink", "Get link")}
        </Button>
        {group.inviteLink && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={copy}
          >
            {copied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            {copied ? "Copied" : "Copy"}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={disabled}
          onClick={() => setConfirmReset(true)}
        >
          {t("groups.resetLink", "Reset link")}
        </Button>
      </div>

      <ConfirmationDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={t("groups.resetLinkConfirm", "Reset the invite link?")}
        description={t(
          "groups.resetLinkDescription",
          "The current link stops working immediately for everyone who has it, and WhatsApp issues a new one. Anyone who already joined stays in the group.",
        )}
        confirmText={t("groups.resetLink", "Reset link")}
        isDestructive
        isLoading={inviteLink.isPending}
        onConfirm={async () => {
          await inviteLink.mutateAsync({ groupId: group.id, reset: true });
          setConfirmReset(false);
        }}
      />
    </RightPanelSection>
  );
}
