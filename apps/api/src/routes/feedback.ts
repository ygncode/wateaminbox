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
import {
  emailHeaderText,
  renderBrandedEmail,
  renderPlainTextEmail,
  type BrandedEmailContent,
} from "../lib/email-template.js";
import { env } from "../lib/env.js";
import { serverError } from "../lib/errors.js";

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
  const senderLabel = body.email ?? "Not provided";
  const subjectSender = body.email
    ? emailHeaderText(body.email, "anonymous user")
    : null;
  const content: BrandedEmailContent = {
    preheader: body.email
      ? `New product feedback from ${subjectSender}`
      : "New anonymous product feedback",
    eyebrow: "Product feedback",
    title: "New feedback received",
    paragraphs: ["A visitor submitted feedback through WATeamInbox."],
    details: [{ label: "From", value: senderLabel }],
    callout: { label: "Message", text: body.message },
    note: "Submitted through the public feedback form.",
  };

  const result = await sendEmail({
    to: env.FEEDBACK_TO_EMAIL,
    subject: `WATeamInbox feedback${subjectSender ? ` from ${subjectSender}` : ""}`,
    html: renderBrandedEmail(content),
    text: renderPlainTextEmail(content),
  });

  if (!result.success) {
    return serverError(c, "Failed to submit feedback. Please try again later.");
  }

  return c.json({
    success: true,
    message: "Thank you for your feedback!",
  });
});
