/**
 * Conversation validation schemas
 *
 * Schemas for conversation-related API endpoints.
 */
import { z } from "zod";
import { MessageType } from "@wateaminbox/shared";

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
 * Resolve conversation with optional notes
 */
export const resolveConversationSchema = z.object({
  notes: z.string().max(2000).optional(),
});

export type ResolveConversationInput = z.infer<
  typeof resolveConversationSchema
>;

/**
 * Query params for resolution trend analytics
 */
export const resolutionTrendQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export type ResolutionTrendQuery = z.infer<typeof resolutionTrendQuerySchema>;
