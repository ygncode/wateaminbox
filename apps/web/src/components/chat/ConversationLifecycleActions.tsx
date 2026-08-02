import {
  CheckCircle2,
  Clock,
  PlayCircle,
  RotateCcw,
} from "lucide-react";
import { useState } from "react";
import { useWorkspace } from "@/contexts/workspace-context";
import {
  useConversationState,
  useOpenConversation,
  usePendingConversation,
  useReopenConversation,
  useResolveConversation,
  useResumeConversation,
} from "@/hooks/useConversationLifecycle";
import type { ResolutionOutcome } from "@/lib/api/conversation-state";
import { resolveOpenOrReopenMode } from "./open-reopen-dialog-state";
import { ConversationStatusBadge } from "./ConversationStatusBadge";
import { OpenOrReopenConversationDialog } from "./ReopenConversationDialog";
import { ResolveConversationDialog } from "./ResolveConversationDialog";

/**
 * Resolve/Pending/Open(resume)/Reopen actions for the currently open
 * conversation. Server is authoritative on permissions and validation -
 * these controls just call the case-lifecycle mutations and let the API
 * reject anything invalid (no active case, missing outcome, an unanswered
 * "handled", etc). The status badge and every button's label stay visible
 * at every viewport size (icon-only buttons always carry an `aria-label`
 * too) - lifecycle state is not something to hide on mobile.
 */
export function ConversationLifecycleActions({
  contactId,
}: {
  contactId: string;
}) {
  const { can } = useWorkspace();
  const canManage = can("can_send_messages");
  const { data: state } = useConversationState(contactId);
  const resolveMutation = useResolveConversation(contactId);
  const pendingMutation = usePendingConversation(contactId);
  const resumeMutation = useResumeConversation(contactId);
  const reopenMutation = useReopenConversation(contactId);
  const openMutation = useOpenConversation(contactId);
  const [resolveDialogOpen, setResolveDialogOpen] = useState(false);
  const [openReopenDialogOpen, setOpenReopenDialogOpen] = useState(false);

  if (!canManage || !state) return null;

  // A resolved contact with no prior case gets "Open" (nothing to justify);
  // one with a prior, resolved case gets "Reopen" (reason required).
  const mode = resolveOpenOrReopenMode(state.hasCaseHistory);
  const isReopen = mode === "reopen";
  const openOrReopenMutation = isReopen ? reopenMutation : openMutation;

  const handleResolve = (input: { outcome: ResolutionOutcome; notes?: string }) => {
    resolveMutation.mutate(input, {
      onSuccess: () => setResolveDialogOpen(false),
    });
  };

  const handleOpenOrReopen = (input: { reason?: string }) => {
    if (isReopen) {
      reopenMutation.mutate(
        { reason: input.reason ?? "" },
        { onSuccess: () => setOpenReopenDialogOpen(false) },
      );
    } else {
      openMutation.mutate(input, {
        onSuccess: () => setOpenReopenDialogOpen(false),
      });
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <ConversationStatusBadge status={state.status} />

      {state.status === "pending" && (
        <button
          type="button"
          onClick={() => resumeMutation.mutate()}
          disabled={resumeMutation.isPending}
          aria-label="Open conversation (resume from pending)"
          className="flex h-9 items-center gap-1.5 rounded-full border border-gray-200 px-3 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:border-dark-border dark:text-dark-text-primary dark:hover:bg-dark-tertiary"
        >
          <PlayCircle className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Open</span>
        </button>
      )}

      {state.status !== "resolved" && (
        <>
          <button
            type="button"
            onClick={() => setResolveDialogOpen(true)}
            disabled={resolveMutation.isPending}
            aria-label="Resolve conversation"
            className="flex h-9 items-center gap-1.5 rounded-full border border-gray-200 px-3 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:border-dark-border dark:text-dark-text-primary dark:hover:bg-dark-tertiary"
          >
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Resolve</span>
          </button>
          {state.status !== "pending" && (
            <button
              type="button"
              onClick={() => pendingMutation.mutate()}
              disabled={pendingMutation.isPending}
              aria-label="Mark conversation pending"
              className="flex h-9 items-center gap-1.5 rounded-full border border-gray-200 px-3 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:border-dark-border dark:text-dark-text-primary dark:hover:bg-dark-tertiary"
            >
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Pending</span>
            </button>
          )}
        </>
      )}

      {state.status === "resolved" && (
        <button
          type="button"
          onClick={() => setOpenReopenDialogOpen(true)}
          disabled={openOrReopenMutation.isPending}
          aria-label={isReopen ? "Reopen conversation" : "Open conversation"}
          className="flex h-9 items-center gap-1.5 rounded-full border border-gray-200 px-3 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:border-dark-border dark:text-dark-text-primary dark:hover:bg-dark-tertiary"
        >
          {isReopen ? (
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <PlayCircle className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          <span>{isReopen ? "Reopen" : "Open"}</span>
        </button>
      )}

      <ResolveConversationDialog
        open={resolveDialogOpen}
        onOpenChange={setResolveDialogOpen}
        onConfirm={handleResolve}
        isSubmitting={resolveMutation.isPending}
      />
      <OpenOrReopenConversationDialog
        open={openReopenDialogOpen}
        onOpenChange={setOpenReopenDialogOpen}
        onConfirm={handleOpenOrReopen}
        isSubmitting={openOrReopenMutation.isPending}
        mode={mode}
      />
    </div>
  );
}

export default ConversationLifecycleActions;
