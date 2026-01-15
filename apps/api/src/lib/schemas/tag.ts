import { z } from "zod";
import { paginationSchema } from "../schemas.js";

/**
 * Tag route validation schemas
 */

// =============================================================================
// Tag CRUD
// =============================================================================

/**
 * Schema for creating a new tag
 */
export const createTagSchema = z.object({
  name: z
    .string()
    .min(1, "Tag name is required")
    .max(50, "Tag name must be at most 50 characters")
    .trim(),
  color: z
    .string()
    .regex(
      /^#[0-9A-Fa-f]{6}$/,
      "Color must be a valid hex color (e.g., #FF5733)",
    )
    .optional(),
});

export type CreateTagInput = z.infer<typeof createTagSchema>;

/**
 * Schema for updating a tag
 */
export const updateTagSchema = z.object({
  name: z
    .string()
    .min(1, "Tag name is required")
    .max(50, "Tag name must be at most 50 characters")
    .trim()
    .optional(),
  color: z
    .string()
    .regex(
      /^#[0-9A-Fa-f]{6}$/,
      "Color must be a valid hex color (e.g., #FF5733)",
    )
    .nullish(),
});

export type UpdateTagInput = z.infer<typeof updateTagSchema>;

// =============================================================================
// Tag Query
// =============================================================================

/**
 * Schema for listing tags with pagination
 */
export const listTagsQuerySchema = paginationSchema;

export type ListTagsQuery = z.infer<typeof listTagsQuerySchema>;
