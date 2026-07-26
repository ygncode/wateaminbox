import { env } from "../env.js";
import { LogMailDriver } from "./drivers/log.js";
import { ResendMailDriver } from "./drivers/resend.js";
import type { EmailOptions, EmailResult, MailDriver } from "./types.js";

export type MailDriverName = "log" | "resend";

export function createMailDriver(name: string = env.MAIL_DRIVER): MailDriver {
  switch (name) {
    case "log":
      return new LogMailDriver();
    case "resend":
      return new ResendMailDriver({
        apiKey: env.RESEND_API_KEY,
        from: env.EMAIL_FROM,
      });
    default:
      throw new Error(
        `Unsupported MAIL_DRIVER "${name}". Expected one of: log, resend`,
      );
  }
}

let activeDriver: MailDriver | null = null;

export function getMailDriver(): MailDriver {
  activeDriver ??= createMailDriver();
  return activeDriver;
}

export async function deliverEmail(
  options: EmailOptions,
): Promise<EmailResult> {
  return getMailDriver().send(options);
}

export type { EmailOptions, EmailResult, MailDriver } from "./types.js";
