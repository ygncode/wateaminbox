import { z } from "zod";

/**
 * Note content validation schemas
 *
 * These schemas validate note content for shared and private notes.
 * Used by the contact notes routes.
 */

/**
 * Schema for note content (create/update)
 * Matches the validation behavior of validateNoteContent() from note.service.ts
 */
export const noteContentSchema = z.object({
  content: z
    .string()
    .min(1, "Content is required")
    .max(10000, "Content is too long")
    .transform((val) => val.trim())
    .refine((val) => val.length > 0, "Content is required"),
});

export type NoteContentInput = z.infer<typeof noteContentSchema>;
