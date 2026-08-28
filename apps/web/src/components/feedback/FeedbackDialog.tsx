import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FeedbackForm } from "./FeedbackForm";
import { useFeedbackForm } from "./useFeedbackForm";

export interface FeedbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Modal wrapper around the shared feedback form.
 *
 * The form state lives here rather than inside the dialog content, which Radix
 * unmounts on close, so a half-written draft survives an accidental dismissal.
 */
export function FeedbackDialog({ open, onOpenChange }: FeedbackDialogProps) {
  const { t } = useTranslation();
  const form = useFeedbackForm({ onSuccess: () => onOpenChange(false) });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="mx-4 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] gap-6 overflow-y-auto rounded-2xl p-6 sm:w-full sm:max-w-lg sm:p-8">
        <DialogHeader className="pr-8">
          <DialogTitle className="text-xl">
            {t("feedback.title", "Send feedback")}
          </DialogTitle>
          <DialogDescription className="leading-6">
            {t(
              "feedback.description",
              "Tell us what's working and what we can improve.",
            )}
          </DialogDescription>
        </DialogHeader>

        <FeedbackForm form={form} idPrefix="feedback-dialog" autoFocus />
      </DialogContent>
    </Dialog>
  );
}
