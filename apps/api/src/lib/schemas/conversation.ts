/**
 * Conversation validation schemas
 *
 * Schemas for conversation-related API endpoints.
 */
import { z } from "zod";

/**
 * Query params for listing messages in a conversation
 */
export const listConversationMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().uuid().optional(),
});

export type ListConversationMessagesQuery = z.infer<
  typeof listConversationMessagesQuerySchema
>;

/**
 * Send a message in a conversation
 */
export const sendConversationMessageSchema = z.object({
  content: z.string().optional(),
  messageType: z
    .enum([
      "text",
      "image",
      "video",
      "audio",
      "document",
      "sticker",
      "location",
      "contact",
    ])
    .default("text"),
  mediaUrl: z.string().url().optional(),
  replyToMessageId: z.string().uuid().optional(),
});

export type SendConversationMessageInput = z.infer<
  typeof sendConversationMessageSchema
>;

/**
 * Close outcomes for resolving a conversation case. `other` additionally
 * requires non-empty `notes` (enforced below and by a DB check constraint).
 * `no_reply_needed`/`spam`/`duplicate` are valid response-SLA exclusions;
 * `handled`/`other` never silently turn an unanswered episode compliant -
 * that's enforced in analytics, not here (see episode-outcome.ts).
 */
export const resolutionOutcomeSchema = z.enum([
  "handled",
  "no_reply_needed",
  "spam",
  "duplicate",
  "other",
]);

export const resolveConversationSchema = z
  .object({
    outcome: resolutionOutcomeSchema,
    notes: z.string().trim().max(2000).optional(),
  })
  .refine((input) => input.outcome !== "other" || !!input.notes?.length, {
    message: "Notes are required when the outcome is 'other'",
    path: ["notes"],
  });

export type ResolveConversationInput = z.infer<
  typeof resolveConversationSchema
>;

/**
 * Manually opens (no prior case) or reopens (a prior, resolved case
 * exists) a conversation - the service determines which and, for a
 * genuine reopen, REQUIRES a non-empty `reason` (see
 * conversation-case.service.ts's `reopenAsNewCase`). It stays optional
 * here at the schema level since a first-ever manual Open needs no
 * justification.
 */
export const openConversationSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export type OpenConversationInput = z.infer<typeof openConversationSchema>;

/**
 * Query params for resolution trend analytics
 */
export const resolutionTrendQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export type ResolutionTrendQuery = z.infer<typeof resolutionTrendQuerySchema>;
