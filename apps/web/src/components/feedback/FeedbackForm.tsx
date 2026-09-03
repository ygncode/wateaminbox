import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  FEEDBACK_EMAIL_MAX_LENGTH,
  FEEDBACK_MAX_LENGTH,
} from "./feedback-form";
import type { FeedbackFormController } from "./useFeedbackForm";

export interface FeedbackFormProps {
  /** Controller from `useFeedbackForm`, owned by the surface rendering this. */
  form: FeedbackFormController;
  /**
   * Prefix for element ids so two feedback surfaces (dialog and Settings) can
   * be mounted at once without colliding label/`aria-describedby` targets.
   */
  idPrefix: string;
  autoFocus?: boolean;
  /** Render the "feedback sent" confirmation inline (surfaces that stay open). */
  showSuccess?: boolean;
  className?: string;
}

/**
 * Shared feedback fields: message, optional email, and the submit action.
 *
 * Purely presentational — validation, submission, toasts, and reset all live in
 * `useFeedbackForm`, so the floating widget and the Settings panel behave
 * identically.
 */
export function FeedbackForm({
  form,
  idPrefix,
  autoFocus = false,
  showSuccess = false,
  className,
}: FeedbackFormProps) {
  const { t } = useTranslation();

  const messageId = `${idPrefix}-message`;
  const emailId = `${idPrefix}-email`;
  const counterId = `${idPrefix}-counter`;
  const errorId = `${idPrefix}-error`;

  const messageInvalid = form.errorField === "message";
  const emailInvalid = form.errorField === "email";

  return (
    <form onSubmit={form.handleSubmit} className={cn("grid gap-5", className)}>
      <div className="grid gap-2">
        <Label htmlFor={messageId}>
          {t("feedback.messageLabel", "Message")}
        </Label>
        <Textarea
          id={messageId}
          value={form.draft.message}
          onChange={(event) => form.setMessage(event.target.value)}
          placeholder={t("feedback.messagePlaceholder", "Share your thoughts…")}
          maxLength={FEEDBACK_MAX_LENGTH}
          rows={6}
          className="min-h-[9rem] leading-6"
          aria-invalid={messageInvalid}
          aria-describedby={
            messageInvalid ? `${counterId} ${errorId}` : counterId
          }
          autoFocus={autoFocus}
          disabled={form.submitting}
          required
        />
        <p
          id={counterId}
          className="text-right text-xs tabular-nums text-gray-500 dark:text-dark-text-tertiary"
        >
          {t("feedback.counter", "{{current}}/{{max}}", {
            current: form.draft.message.length,
            max: FEEDBACK_MAX_LENGTH,
          })}
        </p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor={emailId}>
          {t("feedback.emailLabel", "Email (optional)")}
        </Label>
        <Input
          id={emailId}
          type="email"
          value={form.draft.email}
          onChange={(event) => form.setEmail(event.target.value)}
          placeholder="you@example.com"
          maxLength={FEEDBACK_EMAIL_MAX_LENGTH}
          aria-invalid={emailInvalid}
          aria-describedby={emailInvalid ? errorId : `${idPrefix}-email-hint`}
          disabled={form.submitting}
        />
        {!emailInvalid && (
          <p
            id={`${idPrefix}-email-hint`}
            className="text-xs leading-4 text-gray-500 dark:text-dark-text-tertiary"
          >
            {t(
              "feedback.emailHint",
              "Add your email if you'd like a reply from us.",
            )}
          </p>
        )}
      </div>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div aria-live="polite" className="min-w-0 text-sm">
          {form.error && (
            <p
              id={errorId}
              role="alert"
              className="flex items-start gap-1.5 text-xs font-medium leading-4 text-red-600 dark:text-red-400"
            >
              <CircleAlert
                aria-hidden="true"
                className="mt-px h-3.5 w-3.5 shrink-0"
              />
              {form.error}
            </p>
          )}
          {showSuccess && form.submitted && !form.error && (
            <p className="flex items-start gap-1.5 text-xs font-medium leading-4 text-[#0b7a55] dark:text-emerald-400">
              <CircleCheck
                aria-hidden="true"
                className="mt-px h-3.5 w-3.5 shrink-0"
              />
              {t("feedback.success", "Thank you for your feedback!")}
            </p>
          )}
        </div>

        <Button
          type="submit"
          disabled={!form.canSubmit}
          className="w-full sm:w-auto"
        >
          {form.submitting ? (
            <>
              <LoaderCircle
                aria-hidden="true"
                className="mr-2 h-4 w-4 animate-spin"
              />
              {t("feedback.submitting", "Sending…")}
            </>
          ) : (
            t("feedback.submit", "Submit feedback")
          )}
        </Button>
      </div>
    </form>
  );
}
