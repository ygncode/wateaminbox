import { ApiRequestError } from "./api/client";

/** Only this stable API code should expose the credential-backed resend action. */
export function isEmailVerificationRequiredError(error: unknown): boolean {
  return (
    error instanceof ApiRequestError && error.code === "EMAIL_NOT_VERIFIED"
  );
}
