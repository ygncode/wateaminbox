import { z } from "zod";
import { messageTypeSchema, paginationSchema, uuidSchema } from "../schemas.js";

/**
 * Message route validation schemas
 */

// =============================================================================
// Send Message
// =============================================================================

/**
 * Schema for sending a new message
 */
export const sendMessageSchema = z.object({
  contactId: uuidSchema,
  content: z.string().optional(),
  messageType: messageTypeSchema.default("text"),
  mediaUrl: z.string().url().optional(),
  replyToMessageId: uuidSchema.optional(),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;

/**
 * Schema for forwarding a message
 */
export const forwardMessageSchema = z.object({
  targetContactId: uuidSchema,
});

export type ForwardMessageInput = z.infer<typeof forwardMessageSchema>;

// =============================================================================
// Message Query
// =============================================================================

/**
 * Schema for fetching messages with filters
 */
export const listMessagesQuerySchema = paginationSchema.extend({
  contactId: uuidSchema.optional(),
  before: z.string().datetime().optional(),
  after: z.string().datetime().optional(),
  starred: z
    .string()
    .optional()
    .transform((val) => val === "true"),
  search: z.string().optional(),
});

export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;

// =============================================================================
// Message Reactions
// =============================================================================

/**
 * Schema for adding a reaction to a message
 */
export const addReactionSchema = z.object({
  emoji: z.string().min(1, "Emoji is required").max(10),
});

export type AddReactionInput = z.infer<typeof addReactionSchema>;

// =============================================================================
// Batch Operations
// =============================================================================

const BATCH_LIMIT = 50;

/**
 * Base schema for batch operations
 */
const batchMessageIdsSchema = z
  .array(z.string().uuid())
  .min(1, "At least one message ID is required")
  .max(BATCH_LIMIT, `Maximum ${BATCH_LIMIT} messages per batch request`);

/**
 * Schema for batch star operation
 */
export const batchStarSchema = z.object({
  messageIds: batchMessageIdsSchema,
  star: z.boolean().default(true),
});

export type BatchStarInput = z.infer<typeof batchStarSchema>;

/**
 * Schema for batch delete operation
 */
export const batchDeleteSchema = z.object({
  messageIds: batchMessageIdsSchema,
});

export type BatchDeleteInput = z.infer<typeof batchDeleteSchema>;

/**
 * Schema for generic batch message operations
 */
export const batchMessageOperationSchema = z.object({
  messageIds: batchMessageIdsSchema,
  operation: z.enum(["star", "unstar", "delete"]),
});

export type BatchMessageOperationInput = z.infer<
  typeof batchMessageOperationSchema
>;
