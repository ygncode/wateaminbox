import { X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { submitFeedback } from "@/lib/api/feedback";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const FEEDBACK_DISMISSED_KEY = "wateaminbox-feedback-dismissed";
const FEEDBACK_MIN_LENGTH = 10;
const FEEDBACK_MAX_LENGTH = 5000;

function readDismissed(): boolean {
  try {
    return localStorage.getItem(FEEDBACK_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Floating feedback widget.
 *
 * Renders a vertical "Feedback" tab docked to the right edge of the viewport.
 * Clicking the tab opens a dialog whose form posts to the public `/api/feedback`
 * endpoint. The × button dismisses the tab permanently for this browser.
 */
export function FeedbackWidget() {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(readDismissed);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (dismissed) {
    return null;
  }

  const handleDismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(FEEDBACK_DISMISSED_KEY, "1");
    } catch {
      // Ignore storage failures; the tab will simply return on next reload.
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (message.trim().length < FEEDBACK_MIN_LENGTH) {
      toast.error(
        t("feedback.minLength", "Feedback must be at least 10 characters."),
      );
      return;
    }

    setSubmitting(true);
    try {
      await submitFeedback({
        message: message.trim(),
        email: email.trim() || undefined,
      });
      toast.success(t("feedback.success", "Thank you for your feedback!"));
      setOpen(false);
      setMessage("");
      setEmail("");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t(
              "feedback.error",
              "Failed to submit feedback. Please try again later.",
            ),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="fixed right-0 top-1/2 z-40 -translate-y-1/2">
        <div className="flex flex-col items-center overflow-hidden rounded-l-lg bg-zinc-900 text-white shadow-lg dark:bg-black">
          <button
            type="button"
            onClick={handleDismiss}
            aria-label={t("feedback.dismiss", "Dismiss feedback tab")}
            className="grid h-8 w-9 place-items-center text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rotate-180 px-2.5 py-5 text-xs font-semibold uppercase tracking-[0.2em] transition-colors [writing-mode:vertical-rl] hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60"
          >
            {t("feedback.tab", "Feedback")}
          </button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("feedback.title", "Send feedback")}</DialogTitle>
            <DialogDescription>
              {t(
                "feedback.description",
                "Tell us what's working and what we can improve.",
              )}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="feedback-message">
                {t("feedback.messageLabel", "Message")}
              </Label>
              <Textarea
                id="feedback-message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder={t(
                  "feedback.messagePlaceholder",
                  "Share your thoughts…",
                )}
                maxLength={FEEDBACK_MAX_LENGTH}
                rows={5}
                autoFocus
                required
              />
              <p className="text-right text-xs tabular-nums text-gray-500 dark:text-dark-text-tertiary">
                {message.length}/{FEEDBACK_MAX_LENGTH}
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="feedback-email">
                {t("feedback.emailLabel", "Email (optional)")}
              </Label>
              <Input
                id="feedback-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                maxLength={254}
              />
            </div>

            <DialogFooter>
              <Button
                type="submit"
                disabled={
                  submitting || message.trim().length < FEEDBACK_MIN_LENGTH
                }
              >
                {submitting
                  ? t("feedback.submitting", "Sending…")
                  : t("feedback.submit", "Submit feedback")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
