import { env } from "./env.js";
import { createLogger } from "./logger.js";

const logger = createLogger("Email");

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

/**
 * Send an email using Resend
 * This is a placeholder implementation - integrate with Resend API
 */
export async function sendEmail(options: EmailOptions): Promise<EmailResult> {
  // In development, just log the email
  if (env.NODE_ENV === "development" || !env.RESEND_API_KEY) {
    logger.info(
      { to: options.to, subject: options.subject },
      "Email (dev mode) - not sending",
    );
    logger.debug({ body: options.text || options.html }, "Email body");
    return { success: true, messageId: "dev-" + Date.now() };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      return {
        success: false,
        error: errorData.message || "Failed to send email",
      };
    }

    const data = await response.json();
    return { success: true, messageId: data.id };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Send email verification link
 */
export async function sendVerificationEmail(
  email: string,
  token: string,
): Promise<EmailResult> {
  const verificationUrl = `${env.APP_URL}/verify-email?token=${token}`;

  return sendEmail({
    to: email,
    subject: "Verify your email address",
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #333;">Verify your email address</h1>
        <p>Thank you for signing up! Please click the button below to verify your email address.</p>
        <a href="${verificationUrl}" style="display: inline-block; background-color: #22c55e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 16px 0;">
          Verify Email
        </a>
        <p style="color: #666; font-size: 14px;">
          Or copy and paste this link into your browser:<br/>
          <a href="${verificationUrl}">${verificationUrl}</a>
        </p>
        <p style="color: #666; font-size: 14px;">
          This link will expire in 24 hours.
        </p>
      </div>
    `,
    text: `Verify your email address by clicking this link: ${verificationUrl}. This link will expire in 24 hours.`,
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

  return sendEmail({
    to: email,
    subject: "Reset your password",
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #333;">Reset your password</h1>
        <p>We received a request to reset your password. Click the button below to set a new password.</p>
        <a href="${resetUrl}" style="display: inline-block; background-color: #22c55e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 16px 0;">
          Reset Password
        </a>
        <p style="color: #666; font-size: 14px;">
          Or copy and paste this link into your browser:<br/>
          <a href="${resetUrl}">${resetUrl}</a>
        </p>
        <p style="color: #666; font-size: 14px;">
          This link will expire in 1 hour. If you didn't request a password reset, you can ignore this email.
        </p>
      </div>
    `,
    text: `Reset your password by clicking this link: ${resetUrl}. This link will expire in 1 hour. If you didn't request a password reset, you can ignore this email.`,
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

  return sendEmail({
    to: email,
    subject: `You've been invited to join ${companyName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #333;">You're invited to join ${companyName}</h1>
        <p>${inviterEmail} has invited you to join their team on WhatsApp Web.</p>
        <p>Click the button below to accept the invitation and get started.</p>
        <a href="${inviteUrl}" style="display: inline-block; background-color: #22c55e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 16px 0;">
          Accept Invitation
        </a>
        <p style="color: #666; font-size: 14px;">
          Or copy and paste this link into your browser:<br/>
          <a href="${inviteUrl}">${inviteUrl}</a>
        </p>
        <p style="color: #666; font-size: 14px;">
          This invitation will expire in 7 days.
        </p>
      </div>
    `,
    text: `You've been invited to join ${companyName} by ${inviterEmail}. Accept the invitation by clicking this link: ${inviteUrl}. This invitation will expire in 7 days.`,
  });
}
