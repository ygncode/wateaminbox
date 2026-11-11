/**
 * Pure feedback-form rules for the Settings panel. Kept free of React so the
 * bounds and the validation order can be unit-tested without rendering.
 *
 * The bounds mirror the server schema in `apps/api/src/routes/feedback.ts`;
 * validating here only buys a friendlier message, never authority.
 */

import type { SubmitFeedbackInput } from "@/lib/api/feedback";

export const FEEDBACK_MIN_LENGTH = 10;
export const FEEDBACK_MAX_LENGTH = 5000;
/** Matches the server's `z.string().email().max(254)` upper bound. */
export const FEEDBACK_EMAIL_MAX_LENGTH = 254;

/** i18n suffix under `feedback.*` for the matching error string. */
export type FeedbackValidationError =
  | "minLength"
  | "maxLength"
  | "invalidEmail";

export interface FeedbackDraft {
  message: string;
  /** Empty string means "not provided"; the field is optional. */
  email: string;
}

export const EMPTY_FEEDBACK_DRAFT: FeedbackDraft = { message: "", email: "" };

/**
 * Deliberately permissive: the server (and the browser's own `type="email"`
 * parsing) is authoritative. This only catches obvious typos before a request
 * that would come back as an opaque 400.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** `true` once the message alone is long enough to enable the submit button. */
export function isFeedbackSubmittable(draft: FeedbackDraft): boolean {
  const length = draft.message.trim().length;
  return length >= FEEDBACK_MIN_LENGTH && length <= FEEDBACK_MAX_LENGTH;
}

/**
 * Returns the first rule the draft breaks, or `null` when it is ready to send.
 * Message problems win over email problems so the primary field is fixed first.
 */
export function validateFeedbackDraft(
  draft: FeedbackDraft,
): FeedbackValidationError | null {
  const message = draft.message.trim();
  if (message.length < FEEDBACK_MIN_LENGTH) return "minLength";
  if (message.length > FEEDBACK_MAX_LENGTH) return "maxLength";

  const email = draft.email.trim();
  if (email.length > 0) {
    if (email.length > FEEDBACK_EMAIL_MAX_LENGTH) return "invalidEmail";
    if (!EMAIL_PATTERN.test(email)) return "invalidEmail";
  }

  return null;
}

/** Trims the draft into the request body; an empty email is omitted entirely. */
export function toFeedbackPayload(draft: FeedbackDraft): SubmitFeedbackInput {
  const email = draft.email.trim();
  return {
    message: draft.message.trim(),
    ...(email ? { email } : {}),
  };
}
