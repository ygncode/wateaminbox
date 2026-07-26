import type { EmailOptions, EmailResult, MailDriver } from "../types.js";

interface ResendErrorResponse {
  message?: string;
}

interface ResendSuccessResponse {
  id?: string;
}

export interface ResendMailDriverOptions {
  apiKey: string;
  from: string;
  fetch?: typeof fetch;
}

/** Production transport backed by the Resend HTTP API. */
export class ResendMailDriver implements MailDriver {
  readonly name = "resend";
  private readonly apiKey: string;
  private readonly from: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ResendMailDriverOptions) {
    this.apiKey = options.apiKey;
    this.from = options.from;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async send(options: EmailOptions): Promise<EmailResult> {
    if (!this.apiKey) {
      return {
        success: false,
        error: "Resend mail driver requires RESEND_API_KEY",
      };
    }

    try {
      const response = await this.fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.from,
          to: options.to,
          subject: options.subject,
          html: options.html,
          text: options.text,
        }),
      });

      if (!response.ok) {
        const errorData = (await response.json()) as ResendErrorResponse;
        return {
          success: false,
          error: errorData.message || "Failed to send email through Resend",
        };
      }

      const data = (await response.json()) as ResendSuccessResponse;
      return { success: true, messageId: data.id };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown email error",
      };
    }
  }
}
