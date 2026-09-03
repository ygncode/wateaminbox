/**
 * Pure feedback-form rules shared by every entry point (the floating tab's
 * dialog and the Settings panel). Kept free of React so the bounds, the
 * validation order, and the dismissal storage can be unit-tested without
 * rendering, and so both surfaces cannot drift apart.
 *
 * The bounds mirror the server schema in `apps/api/src/routes/feedback.ts`;
 * validating here only buys a friendlier message, never authority.
 */

import type { SubmitFeedbackInput } from "@/lib/api/feedback";

export const FEEDBACK_MIN_LENGTH = 10;
export const FEEDBACK_MAX_LENGTH = 5000;
/** Matches the server's `z.string().email().max(254)` upper bound. */
export const FEEDBACK_EMAIL_MAX_LENGTH = 254;

export const FEEDBACK_DISMISSED_KEY = "wateaminbox-feedback-dismissed";

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

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function storage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Storage access can throw outright when cookies/site data are blocked.
    return null;
  }
}

/** Whether this browser dismissed the floating feedback tab. */
export function readFeedbackDismissed(store: StorageLike | null = storage()) {
  try {
    return store?.getItem(FEEDBACK_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Dismisses the floating tab for this browser. Failures are ignored: the tab
 * simply returns on the next reload, and Settings → Feedback stays reachable
 * either way.
 */
export function writeFeedbackDismissed(
  store: StorageLike | null = storage(),
): void {
  try {
    store?.setItem(FEEDBACK_DISMISSED_KEY, "1");
  } catch {
    // Ignore storage failures (private mode, quota, blocked site data).
  }
}
