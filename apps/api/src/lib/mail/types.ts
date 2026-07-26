export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/** Transport contract implemented by every mail provider. */
export interface MailDriver {
  readonly name: string;
  send(options: EmailOptions): Promise<EmailResult>;
}
