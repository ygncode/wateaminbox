/**
 * Feedback Routes
 *
 * Public endpoint for users to submit product feedback.
 * Sends feedback to the configured feedback recipient via email.
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { sendEmail } from "../lib/email.js";
import { env } from "../lib/env.js";
import { serverError } from "../lib/errors.js";
import { escapeHtml } from "../lib/security.js";

export const feedbackRoutes = new Hono();

// Unauthenticated endpoint, so the body is bounded: without a maximum, one
// request can push an arbitrarily large payload through the mail transport.
const feedbackSchema = z.object({
  message: z
    .string()
    .min(10, "Message must be at least 10 characters")
    .max(5000, "Message must be at most 5000 characters"),
  email: z.string().email("Invalid email format").max(254).optional(),
});

/**
 * POST /feedback - Submit feedback
 * Public endpoint, no authentication required
 */
feedbackRoutes.post("/", zValidator("json", feedbackSchema), async (c) => {
  const body = c.req.valid("json");

  const safeEmail = body.email ? escapeHtml(body.email) : null;
  const safeMessage = escapeHtml(body.message);

  const result = await sendEmail({
    to: env.FEEDBACK_TO_EMAIL,
    subject: `WATeamInbox Feedback${body.email ? ` from ${body.email}` : ""}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #333;">New Feedback Received</h1>
        ${safeEmail ? `<p><strong>From:</strong> ${safeEmail}</p>` : "<p><em>No email provided</em></p>"}
        <div style="background-color: #f5f5f5; padding: 16px; border-radius: 6px; margin: 16px 0;">
          <p style="white-space: pre-wrap; margin: 0;">${safeMessage}</p>
        </div>
        <p style="color: #666; font-size: 12px;">
          Submitted via WATeamInbox feedback form
        </p>
      </div>
    `,
    text: `New feedback${body.email ? ` from ${body.email}` : ""}:\n\n${body.message}`,
  });

  if (!result.success) {
    return serverError(c, "Failed to submit feedback. Please try again later.");
  }

  return c.json({
    success: true,
    message: "Thank you for your feedback!",
  });
});
