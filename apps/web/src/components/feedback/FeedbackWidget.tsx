import { X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { readFeedbackDismissed, writeFeedbackDismissed } from "./feedback-form";
import { FeedbackDialog } from "./FeedbackDialog";

/**
 * Floating feedback widget.
 *
 * Renders a vertical "Feedback" tab docked to the right edge of the viewport.
 * Clicking the tab opens the shared feedback dialog. The × button dismisses the
 * tab permanently for this browser; Settings → Feedback stays available for
 * anyone who dismissed it.
 */
export function FeedbackWidget() {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(readFeedbackDismissed);
  const [open, setOpen] = useState(false);

  if (dismissed) {
    return null;
  }

  const handleDismiss = () => {
    setDismissed(true);
    writeFeedbackDismissed();
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

      <FeedbackDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
