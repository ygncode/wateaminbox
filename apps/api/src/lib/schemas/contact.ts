import { z } from "zod";
import { paginationSchema } from "../schemas.js";

/**
 * Contact route validation schemas
 */

// =============================================================================
// Contact CRUD
// =============================================================================

/**
 * Schema for creating a new contact
 */
export const createContactSchema = z.object({
  phoneNumber: z.string().min(1, "Phone number is required"),
  connectionId: z.string().uuid().optional(),
  customName: z.string().max(255).optional(),
  notesShared: z.string().optional(),
});

export type CreateContactInput = z.infer<typeof createContactSchema>;

/**
 * Schema for updating a contact
 */
export const updateContactSchema = z.object({
  customName: z.string().max(255).nullish(),
  notesShared: z.string().nullish(),
  isBlocked: z.boolean().optional(),
});

export type UpdateContactInput = z.infer<typeof updateContactSchema>;

// =============================================================================
// Contact Query
// =============================================================================

/**
 * Schema for listing contacts with filters
 */
export const listContactsQuerySchema = paginationSchema.extend({
  search: z.string().optional(),
  connectionId: z.string().uuid().optional(),
  includeGroups: z
    .string()
    .optional()
    .transform((val) => val === "true"),
  assignedToMe: z
    .string()
    .optional()
    .transform((val) => val === "true"),
  unassigned: z
    .string()
    .optional()
    .transform((val) => val === "true"),
});

export type ListContactsQuery = z.infer<typeof listContactsQuerySchema>;

// =============================================================================
// Contact Notes
// =============================================================================

/**
 * Schema for creating a contact note
 */
export const createContactNoteSchema = z.object({
  content: z.string().min(1, "Note content is required"),
  isPrivate: z.boolean().default(false),
});

export type CreateContactNoteInput = z.infer<typeof createContactNoteSchema>;

/**
 * Schema for updating a contact note
 */
export const updateContactNoteSchema = z.object({
  content: z.string().min(1, "Note content is required").optional(),
  isPrivate: z.boolean().optional(),
});

export type UpdateContactNoteInput = z.infer<typeof updateContactNoteSchema>;

// =============================================================================
// Contact Assignment
// =============================================================================

/**
 * Schema for assigning a contact to a user
 */
export const assignContactSchema = z.object({
  targetUserId: z.string().uuid("Invalid user ID").optional(),
});

export type AssignContactInput = z.infer<typeof assignContactSchema>;

// =============================================================================
// Contact Import
// =============================================================================

/**
 * Schema for contact import options
 */
export const importContactsOptionsSchema = z.object({
  skipDuplicates: z.boolean().default(true),
  updateExisting: z.boolean().default(false),
});

export type ImportContactsOptions = z.infer<typeof importContactsOptionsSchema>;

// =============================================================================
// Contact Tags
// =============================================================================

/**
 * Schema for adding a tag to a contact
 */
export const addContactTagSchema = z.object({
  tagId: z.string().uuid("Invalid tag ID"),
});

export type AddContactTagInput = z.infer<typeof addContactTagSchema>;
