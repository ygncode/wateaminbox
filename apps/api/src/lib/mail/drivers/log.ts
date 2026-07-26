import { nowMs } from "@wateaminbox/shared";
import { createLogger } from "../../logger.js";
import type { EmailOptions, EmailResult, MailDriver } from "../types.js";

const logger = createLogger("Email");

/** Local mail transport that captures the complete message in the API log. */
export class LogMailDriver implements MailDriver {
  readonly name = "log";

  async send(options: EmailOptions): Promise<EmailResult> {
    const messageId = `log-${nowMs()}`;

    logger.info(
      {
        driver: this.name,
        messageId,
        to: options.to,
        subject: options.subject,
        body: options.text ?? options.html,
      },
      "Email captured",
    );

    return { success: true, messageId };
  }
}
