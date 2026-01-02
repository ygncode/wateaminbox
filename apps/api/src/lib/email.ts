import { env } from "./env.js";

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
    console.log("--- Email (dev mode) ---");
    console.log(`To: ${options.to}`);
    console.log(`Subject: ${options.subject}`);
    console.log(`Body: ${options.text || options.html}`);
    console.log("------------------------");
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
