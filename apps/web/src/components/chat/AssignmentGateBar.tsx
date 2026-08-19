import { Loader2, Lock, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { useAssignContact } from "@/hooks/contact";
import type { ComposerAccessState } from "./composer-access";
import { useTranslation } from "react-i18next";

interface AssignmentGateBarProps {
  contactId: string;
  access: Extract<
    ComposerAccessState,
    { kind: "assigned-other-readonly" | "assigned-other-takeover" }
  >;
}

/**
 * Replaces the composer entirely when the contact is actively assigned to
 * someone else - a hard send invariant (see requireSendAccess on the API
 * side), not a UI preference. Read-only for anyone without
 * can_assign_contacts; a Take over action for anyone who has it.
 */
export function AssignmentGateBar({
  contactId,
  access,
}: AssignmentGateBarProps) {
  const { t } = useTranslation();

  const takeOverMutation = useAssignContact();

  const handleTakeOver = () => {
    takeOverMutation.mutate(contactId, {
      onSuccess: () =>
        toast.success(
          t("chat.takeOverSuccess", "You've taken over this conversation"),
        ),
      onError: (err) =>
        toast.error(
          err instanceof Error
            ? err.message
            : t("chat.takeOverError", "Could not take over conversation"),
        ),
    });
  };

  if (access.kind === "assigned-other-takeover") {
    return (
      <div className="flex items-center justify-between gap-3 border-t border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-950/20">
        <div className="flex items-center gap-2 text-sm text-amber-900 dark:text-amber-200">
          <UserCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Assigned to {access.assignedToName}</span>
        </div>
        <button
          type="button"
          onClick={handleTakeOver}
          disabled={takeOverMutation.isPending}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
        >
          {takeOverMutation.isPending && (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          )}
          Take over
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 border-t border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600 dark:border-dark-border dark:bg-dark-tertiary/50 dark:text-dark-text-secondary">
      <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        Assigned to {access.assignedToName} - you can't send messages here
      </span>
    </div>
  );
}

export default AssignmentGateBar;
