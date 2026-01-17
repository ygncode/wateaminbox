/**
 * Feedback Routes
 *
 * Public endpoint for users to submit feedback from the marketing site.
 * Sends feedback to contact@wateaminbox.com via email.
 */
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { sendEmail } from "../lib/email.js";
import { badRequest, serverError } from "../lib/errors.js";

export const feedbackRoutes = new Hono();

const feedbackSchema = z.object({
  message: z.string().min(10, "Message must be at least 10 characters"),
  email: z.string().email("Invalid email format").optional(),
});

/**
 * POST /feedback - Submit feedback
 * Public endpoint, no authentication required
 */
feedbackRoutes.post("/", zValidator("json", feedbackSchema), async (c) => {
  const body = c.req.valid("json");

  const result = await sendEmail({
    to: "contact@wateaminbox.com",
    subject: `WATeamInbox Feedback${body.email ? ` from ${body.email}` : ""}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #333;">New Feedback Received</h1>
        ${body.email ? `<p><strong>From:</strong> ${body.email}</p>` : "<p><em>No email provided</em></p>"}
        <div style="background-color: #f5f5f5; padding: 16px; border-radius: 6px; margin: 16px 0;">
          <p style="white-space: pre-wrap; margin: 0;">${body.message}</p>
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
