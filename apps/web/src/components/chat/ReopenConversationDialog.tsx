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
import {
  type OpenOrReopenMode,
  validateOpenOrReopenReason,
} from "./open-reopen-dialog-state";

interface OpenOrReopenConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (input: { reason?: string }) => void;
  isSubmitting?: boolean;
  /**
   * "reopen" is a prior, resolved case being reopened as a brand-new case -
   * a reason is required for auditability. "open" is a genuine first-ever
   * manual open with no prior case to justify - reason is optional.
   */
  mode: OpenOrReopenMode;
}

/**
 * Shared Open/Reopen dialog. An automatic reopen from a live inbound
 * message needs no human justification; a manual one does when there is a
 * prior case to explain reopening.
 */
export function OpenOrReopenConversationDialog({
  open,
  onOpenChange,
  onConfirm,
  isSubmitting = false,
  mode,
}: OpenOrReopenConversationDialogProps) {
  const isReopen = mode === "reopen";
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setReason("");
      setError(null);
    }
    onOpenChange(next);
  };

  const handleConfirm = () => {
    const validationError = validateOpenOrReopenReason(mode, reason);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    onConfirm({ reason: reason.trim() || undefined });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isReopen ? "Reopen conversation" : "Open conversation"}
          </DialogTitle>
          <DialogDescription>
            {isReopen
              ? "This creates a brand-new case - the resolved one is preserved, never overwritten. Explain why this needs to reopen."
              : "This starts tracking the conversation against your SLA targets."}
          </DialogDescription>
        </DialogHeader>

        <label className="block text-sm font-medium text-gray-700 dark:text-dark-text-primary">
          Reason{isReopen ? "" : " (optional)"}
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            rows={3}
            placeholder={
              isReopen
                ? "e.g. Customer followed up outside WhatsApp about the same issue"
                : "e.g. Starting a new conversation thread"
            }
            className="mt-1.5 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-dark-border dark:bg-dark-tertiary"
          />
        </label>
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <button
            type="button"
            onClick={() => handleOpenChange(false)}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-dark-text-primary hover:bg-gray-100 dark:hover:bg-dark-tertiary rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting}
            className="flex items-center gap-2 rounded-lg bg-whatsapp-teal-green px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-whatsapp-teal-green/90 disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {isReopen ? "Reopening…" : "Opening…"}
              </>
            ) : isReopen ? (
              "Reopen"
            ) : (
              "Open"
            )}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default OpenOrReopenConversationDialog;
