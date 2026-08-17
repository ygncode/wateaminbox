import { nowMs } from "@wateaminbox/shared";
import type { EmailOptions, EmailResult, MailDriver } from "../types.js";

/**
 * Cloudflare accepts an address either as a bare string or as an object with a
 * display name. The `Name <address>` form that `EMAIL_FROM` uses is only valid
 * in SMTP headers, so it is split apart for the REST payload.
 */
type CloudflareAddress = string | { address: string; name: string };

/** Every Cloudflare API response, successful or not, uses this envelope. */
interface CloudflareEnvelope {
  success?: unknown;
  errors?: unknown;
  result?: unknown;
}

/**
 * The documented `result` of a successful send: one RFC Message-ID for the
 * send operation, plus the recipient buckets. Every field is typed `unknown`
 * because the values arrive from the network and are validated below.
 */
interface CloudflareSendResult {
  message_id?: unknown;
  delivered?: unknown;
  queued?: unknown;
  permanent_bounces?: unknown;
}

export interface CloudflareMailDriverOptions {
  accountId: string;
  apiToken: string;
  from: string;
  fetch?: typeof fetch;
}

const NAMED_ADDRESS = /^\s*(.*?)\s*<\s*([^<>\s@]+@[^<>\s@]+)\s*>\s*$/;

function toCloudflareAddress(value: string): CloudflareAddress {
  const match = NAMED_ADDRESS.exec(value);
  if (!match) return value.trim();

  const name = match[1].replace(/^"(.*)"$/, "$1").trim();
  const address = match[2];
  return name ? { address, name } : address;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Recipient buckets are documented as string arrays; tolerate anything else. */
function addresses(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === "string") return entry.trim();
      const address = asRecord(entry)?.address;
      return typeof address === "string" ? address.trim() : "";
    })
    .filter(Boolean);
}

function describeError(entry: unknown): string {
  if (typeof entry === "string") return entry.trim();

  const record = asRecord(entry);
  if (!record) return "";

  const message =
    typeof record.message === "string" ? record.message.trim() : "";
  const code = typeof record.code === "number" ? record.code : undefined;
  if (message && code !== undefined) return `${code} ${message}`;
  if (message) return message;
  return code === undefined ? "" : `error code ${code}`;
}

function describeFailure(
  envelope: CloudflareEnvelope | null,
  response: Response,
): string {
  const reasons = Array.isArray(envelope?.errors)
    ? envelope.errors.map(describeError).filter(Boolean)
    : [];
  if (reasons.length > 0) {
    return `Cloudflare Email Service rejected the message: ${reasons.join("; ")}`;
  }
  // A 2xx that still says success:false carries no status worth quoting.
  return response.ok
    ? "Cloudflare Email Service reported a failed send without an error"
    : `Failed to send email through Cloudflare Email Service (HTTP ${response.status})`;
}

/**
 * Production transport backed by the Cloudflare Email Service REST API.
 *
 * A successful send returns one `message_id` for the send operation alongside
 * the recipient buckets (`delivered`, `queued`, `permanent_bounces`), so the
 * `EmailResult` identifier is the provider's own Message-ID, as with Resend.
 */
export class CloudflareMailDriver implements MailDriver {
  readonly name = "cloudflare";
  private readonly accountId: string;
  private readonly apiToken: string;
  private readonly from: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: CloudflareMailDriverOptions) {
    this.accountId = options.accountId;
    this.apiToken = options.apiToken;
    this.from = options.from;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async send(options: EmailOptions): Promise<EmailResult> {
    if (!this.accountId.trim() || !this.apiToken.trim()) {
      return {
        success: false,
        error:
          "Cloudflare mail driver requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_EMAIL_API_TOKEN",
      };
    }

    try {
      const response = await this.fetchImpl(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
          this.accountId.trim(),
        )}/email/sending/send`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiToken.trim()}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: toCloudflareAddress(this.from),
            to: options.to,
            subject: options.subject,
            html: options.html,
            text: options.text,
          }),
        },
      );

      let envelope: CloudflareEnvelope | null;
      try {
        envelope = asRecord(await response.json());
      } catch {
        envelope = null;
      }

      // A transport-level failure is reported even when the body is unusable,
      // because the status alone already tells the operator what happened.
      if (!response.ok) {
        return {
          success: false,
          error: describeFailure(envelope, response),
        };
      }
      if (!envelope) {
        return {
          success: false,
          error: "Cloudflare Email Service returned a malformed response",
        };
      }
      if (envelope.success !== true) {
        return {
          success: false,
          error: describeFailure(envelope, response),
        };
      }

      const result: CloudflareSendResult | null = asRecord(envelope.result);
      const bounced = addresses(result?.permanent_bounces);
      if (bounced.length > 0) {
        return {
          success: false,
          error: `Cloudflare Email Service permanently bounced: ${bounced.join(", ")}`,
        };
      }

      const accepted = [
        ...addresses(result?.delivered),
        ...addresses(result?.queued),
      ];
      if (accepted.length === 0) {
        return {
          success: false,
          error:
            "Cloudflare Email Service accepted the request without reporting a delivered or queued recipient",
        };
      }

      return { success: true, messageId: this.messageId(response, result) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown email error",
      };
    }
  }

  /**
   * The documented identifier is `result.message_id`. The `cf-ray` of the
   * accepting request, then a timestamp, are defensive fallbacks only: a
   * response that omits the field is off-schema, and a caller recording the
   * result still needs something to correlate on.
   */
  private messageId(
    response: Response,
    result: CloudflareSendResult | null,
  ): string {
    const reported = result?.message_id;
    if (typeof reported === "string" && reported.trim()) return reported.trim();

    const ray = response.headers.get("cf-ray")?.trim();
    return ray ? `cloudflare-${ray}` : `cloudflare-${nowMs()}`;
  }
}
