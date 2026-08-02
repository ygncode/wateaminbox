import { z } from "zod";
import { HttpError } from "./errors";

const MAX_JSON_BYTES = 8_192;
const MAX_FORM_BYTES = 4_096;

export const signupSchema = z
  .object({
    email: z
      .string()
      .trim()
      .max(254)
      .email()
      .transform((value) => value.toLowerCase()),
    website: z.string().trim().max(200).optional().default(""),
    formStartedAt: z.number().int().positive().optional(),
    turnstileToken: z.string().trim().min(1).max(2_048).optional(),
  })
  .strict();

export function validIdempotencyKey(
  value: string | undefined,
): value is string {
  return Boolean(value && /^[A-Za-z0-9._~-]{16,128}$/.test(value));
}

export function validOpaqueToken(
  value: string | null | undefined,
): value is string {
  return Boolean(value && /^[A-Za-z0-9_-]{32,128}$/.test(value));
}

function contentLength(request: Request, maximum: number): void {
  const value = request.headers.get("Content-Length");
  if (!value) {
    return;
  }

  const bytes = Number(value);
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maximum) {
    throw new HttpError(413, "Request body is too large.");
  }
}

export async function readJsonBody(request: Request): Promise<unknown> {
  contentLength(request, MAX_JSON_BYTES);
  if (!request.headers.get("Content-Type")?.includes("application/json")) {
    throw new HttpError(415, "Use application/json for this request.");
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_JSON_BYTES) {
    throw new HttpError(413, "Request body is too large.");
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

export async function readFormBody(request: Request): Promise<URLSearchParams> {
  contentLength(request, MAX_FORM_BYTES);
  if (
    !request.headers
      .get("Content-Type")
      ?.includes("application/x-www-form-urlencoded")
  ) {
    throw new HttpError(415, "Use a standard form submission.");
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_FORM_BYTES) {
    throw new HttpError(413, "Request body is too large.");
  }

  return new URLSearchParams(body);
}

export function looksAutomated(
  website: string,
  formStartedAt: number | undefined,
  now: number,
): boolean {
  if (website.length > 0) {
    return true;
  }

  if (!formStartedAt) {
    return false;
  }

  const elapsed = now - formStartedAt;
  return elapsed < 750;
}
