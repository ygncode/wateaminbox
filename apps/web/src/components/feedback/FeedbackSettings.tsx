import { FeedbackForm } from "./FeedbackForm";
import { useFeedbackForm } from "./useFeedbackForm";

/**
 * Feedback form for the Settings page.
 *
 * Shares the form, validation, and submission with the floating widget's
 * dialog. This surface stays open after sending, so it confirms inline instead
 * of relying only on the toast.
 */
export function FeedbackSettings() {
  const form = useFeedbackForm();

  return <FeedbackForm form={form} idPrefix="settings-feedback" showSuccess />;
}
