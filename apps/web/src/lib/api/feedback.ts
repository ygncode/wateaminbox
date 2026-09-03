import { API_BASE_URL } from "./client.js";

export interface SubmitFeedbackInput {
  message: string;
  email?: string;
}

export interface SubmitFeedbackResult {
  success: boolean;
  message: string;
}

/**
 * Submit product feedback.
 *
 * The `/feedback` endpoint is public (no auth and no tenant context), so this
 * uses a plain fetch rather than the authenticated client. The message must be
 * 10–5000 characters and the email is optional; both bounds are also enforced
 * server-side.
 */
export async function submitFeedback(
  input: SubmitFeedbackInput,
): Promise<SubmitFeedbackResult> {
  const response = await fetch(`${API_BASE_URL}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    let message = "Failed to submit feedback. Please try again later.";
    try {
      const data: unknown = await response.json();
      if (
        data &&
        typeof data === "object" &&
        "error" in data &&
        typeof (data as { error: unknown }).error === "string"
      ) {
        message = (data as { error: string }).error;
      }
    } catch {
      // Keep the default message when the error body is not JSON.
    }
    throw new Error(message);
  }

  return (await response.json()) as SubmitFeedbackResult;
}
