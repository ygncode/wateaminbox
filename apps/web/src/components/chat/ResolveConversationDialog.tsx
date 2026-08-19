import { Loader2 } from "lucide-react";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ResolutionOutcome } from "@/lib/api/conversation-state";
import { useTranslation } from "react-i18next";

const OUTCOME_OPTIONS: {
  value: ResolutionOutcome;
  labelKey: string;
  label: string;
  hintKey: string;
  hint: string;
}[] = [
  {
    value: "handled",
    labelKey: "chat.outcomes.handled",
    label: "Handled",
    hintKey: "chat.outcomes.handledHint",
    hint: "We replied and resolved it",
  },
  {
    value: "no_reply_needed",
    labelKey: "chat.outcomes.noReplyNeeded",
    label: "No reply needed",
    hintKey: "chat.outcomes.noReplyNeededHint",
    hint: "Nothing to answer - excluded from response SLA",
  },
  {
    value: "spam",
    labelKey: "chat.outcomes.spam",
    label: "Spam",
    hintKey: "chat.outcomes.spamHint",
    hint: "Excluded from response SLA",
  },
  {
    value: "duplicate",
    labelKey: "chat.outcomes.duplicate",
    label: "Duplicate",
    hintKey: "chat.outcomes.duplicateHint",
    hint: "Excluded from response SLA",
  },
  {
    value: "other",
    labelKey: "chat.outcomes.other",
    label: "Other",
    hintKey: "chat.outcomes.otherHint",
    hint: "Requires a note",
  },
];

interface ResolveConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (input: { outcome: ResolutionOutcome; notes?: string }) => void;
  isSubmitting?: boolean;
  /**
   * True while Confirm must be blocked for a reason OTHER than the resolve
   * mutation itself being in flight - specifically, a send for this contact
   * hasn't settled yet (see lifecycle-action-gating.ts). Disables Confirm
   * without showing the "Resolving…" spinner (nothing is actually being
   * submitted), and covers the case where this dialog was ALREADY open
   * when the send started - disabling only the button that OPENS the
   * dialog (in ConversationLifecycleActions) is not enough on its own.
   */
  disabled?: boolean;
}

export function ResolveConversationDialog({
  open,
  onOpenChange,
  onConfirm,
  isSubmitting = false,
  disabled = false,
}: ResolveConversationDialogProps) {
  const { t } = useTranslation();

  const [outcome, setOutcome] = useState<ResolutionOutcome>("handled");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setOutcome("handled");
      setNotes("");
      setError(null);
    }
    onOpenChange(next);
  };

  const handleConfirm = () => {
    if (disabled) return;
    if (outcome === "other" && !notes.trim()) {
      setError(
        t(
          "chat.notesRequiredForOther",
          "Notes are required when the outcome is 'other'.",
        ),
      );
      return;
    }
    setError(null);
    onConfirm({ outcome, notes: notes.trim() || undefined });
  };

  const confirmDisabled = isSubmitting || disabled;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("chat.resolveConversation", "Resolve conversation")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "chat.resolveConversationDescription",
              "Choose why this conversation is being closed. This ends the active case - a later message from the customer reopens it as a new one.",
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <fieldset className="space-y-2">
            <legend className="sr-only">
              {t("chat.closeOutcome", "Close outcome")}
            </legend>
            {OUTCOME_OPTIONS.map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-gray-200 p-2.5 text-sm has-[:checked]:border-whatsapp-teal-green has-[:checked]:bg-whatsapp-teal-green/5 dark:border-dark-border dark:has-[:checked]:border-whatsapp-teal-green"
              >
                <input
                  type="radio"
                  name="resolution-outcome"
                  value={option.value}
                  checked={outcome === option.value}
                  onChange={() => setOutcome(option.value)}
                  className="mt-0.5"
                />
                <span>
                  <span className="block font-medium text-gray-900 dark:text-dark-text-primary">
                    {t(option.labelKey, option.label)}
                  </span>
                  <span className="block text-xs text-gray-500 dark:text-dark-text-secondary">
                    {t(option.hintKey, option.hint)}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          <label className="block text-sm font-medium text-gray-700 dark:text-dark-text-primary">
            {t("chat.notesLabel", "Notes")}{" "}
            {outcome === "other" && <span className="text-red-500">*</span>}
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={2000}
              rows={3}
              placeholder={
                outcome === "other"
                  ? t(
                      "chat.notesPlaceholderOther",
                      "Describe why this doesn't fit the other outcomes…",
                    )
                  : t("chat.notesPlaceholderOptional", "Optional notes")
              }
              className="mt-1.5 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-dark-border dark:bg-dark-tertiary"
            />
          </label>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
          {disabled && !isSubmitting && (
            <p className="text-sm text-gray-500 dark:text-dark-text-secondary">
              {t(
                "chat.waitingForSend",
                "Waiting for your message to finish sending…",
              )}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <button
            type="button"
            onClick={() => handleOpenChange(false)}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-dark-text-primary hover:bg-gray-100 dark:hover:bg-dark-tertiary rounded-lg transition-colors disabled:opacity-50"
          >
            {t("common.cancel", "Cancel")}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={confirmDisabled}
            className="flex items-center gap-2 rounded-lg bg-whatsapp-teal-green px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-whatsapp-teal-green/90 disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("chat.resolving", "Resolving…")}
              </>
            ) : (
              t("chat.resolve", "Resolve")
            )}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ResolveConversationDialog;
