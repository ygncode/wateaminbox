import { env } from "./env.js";
import {
  deliverEmail,
  type EmailOptions,
  type EmailResult,
} from "./mail/index.js";
import {
  emailHeaderText,
  renderBrandedEmail,
  renderPlainTextEmail,
  type BrandedEmailContent,
} from "./email-template.js";

export type { EmailOptions, EmailResult } from "./mail/index.js";

/** Deliver a composed email through the configured mail driver. */
export async function sendEmail(options: EmailOptions): Promise<EmailResult> {
  return deliverEmail(options);
}

/**
 * Send email verification link
 */
export async function sendVerificationEmail(
  email: string,
  token: string,
  invitationToken?: string,
): Promise<EmailResult> {
  const verificationUrl = new URL("/verify-email", env.APP_URL);
  verificationUrl.searchParams.set("token", token);
  if (invitationToken) {
    verificationUrl.searchParams.set("invitation", invitationToken);
  }
  const verificationUrlString = verificationUrl.toString();
  const content: BrandedEmailContent = {
    preheader: invitationToken
      ? "Confirm your email address to continue to your workspace invitation."
      : "Confirm your email address to finish setting up WATeamInbox.",
    eyebrow: "Account security",
    title: "Verify your email address",
    paragraphs: [
      invitationToken
        ? "Confirm your email address to finish creating your account and continue to the workspace invitation."
        : "Thanks for signing up. Confirm your email address to finish setting up your WATeamInbox account.",
    ],
    action: { label: "Verify email", url: verificationUrlString },
    note: "This link expires in 24 hours. If you did not create this account, you can safely ignore this email.",
  };

  return sendEmail({
    to: email,
    subject: "Verify your email address",
    html: renderBrandedEmail(content),
    text: renderPlainTextEmail(content),
  });
}

/**
 * Send password reset email
 */
export async function sendPasswordResetEmail(
  email: string,
  token: string,
): Promise<EmailResult> {
  const resetUrl = `${env.APP_URL}/reset-password?token=${token}`;
  const content: BrandedEmailContent = {
    preheader: "Use this secure link to choose a new WATeamInbox password.",
    eyebrow: "Account security",
    title: "Reset your password",
    paragraphs: [
      "We received a request to reset the password for your WATeamInbox account.",
      "Use the secure link below to choose a new password.",
    ],
    action: { label: "Reset password", url: resetUrl },
    note: "This link expires in 1 hour. If you did not request a password reset, you can safely ignore this email; your password will not change.",
  };

  return sendEmail({
    to: email,
    subject: "Reset your password",
    html: renderBrandedEmail(content),
    text: renderPlainTextEmail(content),
  });
}

/**
 * Send company invitation email
 */
export async function sendInvitationEmail(
  email: string,
  token: string,
  companyName: string,
  inviterEmail: string,
): Promise<EmailResult> {
  const inviteUrl = `${env.APP_URL}/invite/${token}`;
  const safeCompanyName = emailHeaderText(companyName);
  const content: BrandedEmailContent = {
    preheader: `${inviterEmail} invited you to join ${safeCompanyName} on WATeamInbox.`,
    eyebrow: "Team invitation",
    title: `Join ${safeCompanyName}`,
    paragraphs: [
      "You have been invited to collaborate with the team on WATeamInbox.",
      "Accept the invitation to open the shared inbox and get started.",
    ],
    details: [
      { label: "Workspace", value: companyName },
      { label: "Invited by", value: inviterEmail },
    ],
    action: { label: "Accept invitation", url: inviteUrl },
    note: "This invitation expires in 7 days. If you were not expecting it, you can safely ignore this email.",
  };

  return sendEmail({
    to: email,
    subject: `You've been invited to join ${safeCompanyName}`,
    html: renderBrandedEmail(content),
    text: renderPlainTextEmail(content),
  });
}
