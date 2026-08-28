import { type FormEvent, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { submitFeedback } from "@/lib/api/feedback";
import {
  EMPTY_FEEDBACK_DRAFT,
  type FeedbackDraft,
  type FeedbackValidationError,
  isFeedbackSubmittable,
  toFeedbackPayload,
  validateFeedbackDraft,
} from "./feedback-form";

/** Which field an inline error belongs to, so it can be described and flagged. */
export type FeedbackErrorField = "message" | "email";

const ERROR_FIELD: Record<FeedbackValidationError, FeedbackErrorField> = {
  minLength: "message",
  maxLength: "message",
  invalidEmail: "email",
};

export interface FeedbackFormController {
  draft: FeedbackDraft;
  setMessage: (value: string) => void;
  setEmail: (value: string) => void;
  submitting: boolean;
  /** Human-readable message for the last failed attempt, if any. */
  error: string | null;
  errorField: FeedbackErrorField | null;
  /** `true` after a successful submit, until the draft is edited again. */
  submitted: boolean;
  canSubmit: boolean;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export interface UseFeedbackFormOptions {
  /** Called after the API accepts the feedback (e.g. to close a dialog). */
  onSuccess?: () => void;
}

/**
 * Owns the feedback draft, validation, and submission.
 *
 * Every feedback surface shares this hook so the network call, the toasts, and
 * the validation rules exist once. The caller holds the hook (rather than the
 * form component) so a draft survives a dialog being closed and reopened.
 */
export function useFeedbackForm(
  options: UseFeedbackFormOptions = {},
): FeedbackFormController {
  const { onSuccess } = options;
  const { t } = useTranslation();

  const [draft, setDraft] = useState<FeedbackDraft>(EMPTY_FEEDBACK_DRAFT);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<FeedbackErrorField | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const clearStatus = useCallback(() => {
    setError(null);
    setErrorField(null);
    setSubmitted(false);
  }, []);

  const setMessage = useCallback(
    (value: string) => {
      setDraft((current) => ({ ...current, message: value }));
      clearStatus();
    },
    [clearStatus],
  );

  const setEmail = useCallback(
    (value: string) => {
      setDraft((current) => ({ ...current, email: value }));
      clearStatus();
    },
    [clearStatus],
  );

  const fail = useCallback((field: FeedbackErrorField, message: string) => {
    setSubmitted(false);
    setErrorField(field);
    setError(message);
    toast.error(message);
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (submitting) return;

      const invalid = validateFeedbackDraft(draft);
      if (invalid) {
        fail(ERROR_FIELD[invalid], validationMessage(t, invalid));
        return;
      }

      setSubmitting(true);
      try {
        await submitFeedback(toFeedbackPayload(draft));
        setDraft(EMPTY_FEEDBACK_DRAFT);
        setError(null);
        setErrorField(null);
        setSubmitted(true);
        toast.success(t("feedback.success", "Thank you for your feedback!"));
        onSuccess?.();
      } catch (caught) {
        fail(
          "message",
          caught instanceof Error
            ? caught.message
            : t(
                "feedback.error",
                "Failed to submit feedback. Please try again later.",
              ),
        );
      } finally {
        setSubmitting(false);
      }
    },
    [draft, fail, onSuccess, submitting, t],
  );

  return {
    draft,
    setMessage,
    setEmail,
    submitting,
    error,
    errorField,
    submitted,
    canSubmit: !submitting && isFeedbackSubmittable(draft),
    handleSubmit: (event) => void handleSubmit(event),
  };
}

function validationMessage(
  t: ReturnType<typeof useTranslation>["t"],
  error: FeedbackValidationError,
): string {
  switch (error) {
    case "minLength":
      return t(
        "feedback.minLength",
        "Feedback must be at least 10 characters.",
      );
    case "maxLength":
      return t(
        "feedback.maxLength",
        "Feedback must be at most 5000 characters.",
      );
    case "invalidEmail":
      return t("feedback.invalidEmail", "Enter a valid email address.");
  }
}
