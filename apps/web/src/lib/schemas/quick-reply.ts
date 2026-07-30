import { z } from "zod";

/**
 * Shortcut validation regex
 * Only allows letters, numbers, underscores, and hyphens
 */
const shortcutRegex = /^[a-zA-Z0-9_-]+$/;

/**
 * Create/update quick reply form validation schema
 */
export const quickReplySchema = z.object({
  shortcut: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Shortcut is required")
    .max(50, "Shortcut must be less than 50 characters")
    .regex(
      shortcutRegex,
      "Shortcut can only contain letters, numbers, underscores, and hyphens",
    ),
  title: z
    .string()
    .trim()
    .min(1, "Title is required")
    .max(200, "Title must be less than 200 characters"),
  content: z
    .string()
    .trim()
    .min(1, "Content is required")
    .max(5000, "Content must be less than 5000 characters"),
});

export type QuickReplyFormData = z.infer<typeof quickReplySchema>;
