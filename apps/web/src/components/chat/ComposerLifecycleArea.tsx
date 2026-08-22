import { Lock, PlayCircle, RotateCcw } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import type { ComposerAccessState } from "@/components/chat/composer-access";
import { CONVERSATION_BOTTOM_INSET_CLASS } from "@/components/layout/conversation-chrome";
import {
  useConversationState,
  useOpenConversation,
  useReopenConversation,
} from "@/hooks/useConversationLifecycle";
import { AssignmentGateBar } from "./AssignmentGateBar";
import { ConversationLifecycleActions } from "./ConversationLifecycleActions";
import { resolveOpenOrReopenMode } from "./open-reopen-dialog-state";
import { OpenOrReopenConversationDialog } from "./ReopenConversationDialog";
import { useTranslation } from "react-i18next";

interface ComposerLifecycleAreaProps {
  contactId: string;
  /**
   * Computed by the caller (ChatPage) via useComposerAccess and shared with
   * it, instead of each computing its own - two independent calls to
   * resolveComposerAccess in the same render can never diverge on which
   * message-action handlers (reply/react) or Retry button ChatPage/
   * MessageThread expose vs. what this component actually renders.
   */
  access: ComposerAccessState;
  /**
   * True while a message send for this contact is in flight. Threaded down
   * to the Resolve action (see lifecycle-action-gating.ts) so an agent
   * can't resolve while their own reply's send transaction hasn't
   * committed yet - a real race that produced spurious "unanswered turn"
   * rejections in production.
   */
  isSending?: boolean;
  /** The actual MessageComposer element - only rendered in the "sendable" state; every other state replaces it entirely. */
  children: ReactNode;
}

/**
 * Wraps the message composer with the conversation's lifecycle status/
 * actions (Open/Pending/Resolve/Reopen), and - taking priority over
 * everything else - the loading/permission/assignment gates: see
 * useComposerAccess/resolveComposerAccess for the exact priority rules.
 * Every non-"sendable" state REPLACES the composer with a clear notice
 * (never just disables it silently) and never mounts it at all, so a
 * resolved/blocked conversation can't be typed into even momentarily. This
 * is the single place lifecycle controls live now (no duplicate controls
 * in MessageHeader).
 */
/**
 * Bottom edge of the conversation column.
 *
 * Owns the entire bottom inset, because the app shell reserves none once a
 * conversation is open (see conversation-chrome.ts). That inset is the greater
 * of the home indicator and the on-screen keyboard overlap - one padding
 * declaration, never two stacked boxes: the keyboard already covers the home
 * indicator, so paying both would lift the composer above the keyboard by the
 * indicator's height. iOS is where this shows up, since `env(safe-area-inset-
 * bottom)` stays non-zero there while VisualViewport reports the overlap.
 *
 * `shrink-0` is load-bearing: this is the one part of the column that must
 * never give up space, because the message list above it is the box that
 * scrolls.
 */
function ComposerFooter({ children }: { children: ReactNode }) {
  return (
    <div className={`shrink-0 ${CONVERSATION_BOTTOM_INSET_CLASS}`}>
      {children}
    </div>
  );
}

export function ComposerLifecycleArea({
  contactId,
  access,
  isSending = false,
  children,
}: ComposerLifecycleAreaProps) {
  const { t } = useTranslation();

  const { data: state } = useConversationState(contactId);
  const reopenMutation = useReopenConversation(contactId);
  const openMutation = useOpenConversation(contactId);
  const [dialogOpen, setDialogOpen] = useState(false);

  if (access.kind === "loading") {
    return (
      <ComposerFooter>
        <div className="border-t border-gray-100 bg-white px-4 py-3 dark:border-dark-border dark:bg-dark-elevated">
          <div className="h-9 animate-pulse rounded-lg bg-gray-100 dark:bg-dark-tertiary" />
        </div>
      </ComposerFooter>
    );
  }

  if (access.kind === "no-permission") {
    return (
      <ComposerFooter>
        <div className="flex items-center gap-2 border-t border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600 dark:border-dark-border dark:bg-dark-tertiary/50 dark:text-dark-text-secondary">
          <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            {t(
              "chat.noSendPermission",
              "You don't have permission to send messages here",
            )}
          </span>
        </div>
      </ComposerFooter>
    );
  }

  if (
    access.kind === "assigned-other-readonly" ||
    access.kind === "assigned-other-takeover"
  ) {
    return (
      <ComposerFooter>
        <AssignmentGateBar contactId={contactId} access={access} />
      </ComposerFooter>
    );
  }

  if (access.kind === "resolved") {
    const hasCaseHistory = state?.hasCaseHistory ?? false;
    const mode = resolveOpenOrReopenMode(hasCaseHistory);
    const isReopen = mode === "reopen";
    const isPending = isReopen
      ? reopenMutation.isPending
      : openMutation.isPending;

    const handleConfirm = (input: { reason?: string }) => {
      if (isReopen) {
        reopenMutation.mutate(
          { reason: input.reason ?? "" },
          { onSuccess: () => setDialogOpen(false) },
        );
      } else {
        openMutation.mutate(input, {
          onSuccess: () => setDialogOpen(false),
        });
      }
    };

    return (
      <ComposerFooter>
        <div className="flex items-center justify-between gap-3 border-t border-gray-200 bg-gray-50 px-4 py-3 dark:border-dark-border dark:bg-dark-tertiary/50">
          <span className="text-sm text-gray-600 dark:text-dark-text-secondary">
            {t("chat.conversationResolved", "This conversation is resolved")}
          </span>
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            disabled={isPending}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-whatsapp-teal-green px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-whatsapp-teal-green/90 disabled:opacity-50"
          >
            {isReopen ? (
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <PlayCircle className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {isReopen ? "Reopen" : "Open"} to send
          </button>
          <OpenOrReopenConversationDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            onConfirm={handleConfirm}
            isSubmitting={isPending}
            mode={mode}
          />
        </div>
      </ComposerFooter>
    );
  }

  // "sendable"
  return (
    <ComposerFooter>
      <div className="flex items-center justify-end border-t border-black/[0.06] bg-[#f0f2f5] px-2 py-1 dark:border-white/[0.06] dark:bg-dark-secondary sm:px-3 sm:py-1.5">
        <ConversationLifecycleActions
          contactId={contactId}
          isSending={isSending}
        />
      </div>
      {children}
    </ComposerFooter>
  );
}

export default ComposerLifecycleArea;
