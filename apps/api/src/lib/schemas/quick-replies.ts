import { z } from "zod";

/**
 * Quick Replies validation schemas
 * Centralized schemas for quick reply CRUD operations
 */

/**
 * Shortcut pattern - only letters, numbers, underscores, and hyphens
 */
const shortcutPattern = /^[a-zA-Z0-9_-]+$/;

/**
 * Schema for creating a new quick reply
 */
export const createQuickReplySchema = z.object({
  shortcut: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Shortcut is required")
    .max(50, "Shortcut must be 50 characters or less")
    .regex(
      shortcutPattern,
      "Shortcut can only contain letters, numbers, underscores, and hyphens",
    ),
  title: z
    .string()
    .trim()
    .min(1, "Title is required")
    .max(255, "Title must be 255 characters or less"),
  content: z.string().trim().min(1, "Content is required"),
});

/**
 * Schema for updating a quick reply
 * All fields are optional
 */
export const updateQuickReplySchema = z.object({
  shortcut: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(50)
    .regex(shortcutPattern)
    .optional(),
  title: z.string().trim().min(1).max(255).optional(),
  content: z.string().trim().min(1).optional(),
});

/**
 * Schema for quick reply list query parameters
 */
export const listQuickRepliesQuerySchema = z.object({
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

// Type exports
export type CreateQuickReplyInput = z.infer<typeof createQuickReplySchema>;
export type UpdateQuickReplyInput = z.infer<typeof updateQuickReplySchema>;
export type ListQuickRepliesQuery = z.infer<typeof listQuickRepliesQuerySchema>;
