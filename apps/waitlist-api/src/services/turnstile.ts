import { HttpError } from "../lib/errors";

interface TurnstileResponse {
  action?: string;
  success: boolean;
}

export async function verifyTurnstile(
  secret: string | undefined,
  token: string | undefined,
  remoteIp: string,
): Promise<void> {
  if (!secret) {
    return;
  }

  if (!token) {
    throw new HttpError(400, "Please complete the verification and try again.");
  }

  let response: Response;
  try {
    response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret,
          response: token,
          remoteip: remoteIp === "unknown" ? undefined : remoteIp,
          idempotency_key: crypto.randomUUID(),
        }),
      },
    );
  } catch {
    throw new HttpError(
      503,
      "Verification is unavailable. Please try again shortly.",
    );
  }

  let result: TurnstileResponse;
  try {
    result = (await response.json()) as TurnstileResponse;
  } catch {
    throw new HttpError(
      503,
      "Verification is unavailable. Please try again shortly.",
    );
  }

  if (!response.ok) {
    throw new HttpError(
      503,
      "Verification is unavailable. Please try again shortly.",
    );
  }

  if (!result.success || result.action !== "waitlist") {
    throw new HttpError(400, "Please complete the verification and try again.");
  }
}
