import { z } from "zod";

/**
 * Sound choice for notifications
 */
export const soundChoiceSchema = z.enum([
  "default",
  "chime",
  "bell",
  "pop",
  "none",
]);

/**
 * Notification type
 */
export const notificationTypeSchema = z.enum([
  "message",
  "mention",
  "assignment",
  "team",
  "system",
]);

/**
 * Schema for updating notification preferences
 */
export const updatePreferencesSchema = z.object({
  notificationsEnabled: z.boolean().optional(),
  timezone: z.string().trim().min(1).max(100).nullable().optional(),
  soundEnabled: z.boolean().optional(),
  soundChoice: soundChoiceSchema.optional(),
  quietHoursStart: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .nullable()
    .optional(),
  quietHoursEnd: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .nullable()
    .optional(),
  mutedContacts: z
    .array(z.string().trim().min(1).max(255))
    .max(1000)
    .optional(),
});

export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;

/**
 * Schema for muting a contact
 */
export const muteContactSchema = z.object({
  contactJid: z.string().trim().min(1).max(255),
});

export type MuteContactInput = z.infer<typeof muteContactSchema>;

/**
 * Boolean flag arriving as a query-string value.
 *
 * `z.coerce.boolean()` is wrong here: it applies JavaScript truthiness, so the
 * literal string "false" that clients send for a disabled flag becomes `true`.
 * Only the affirmative spellings enable the flag; everything else disables it.
 */
const queryBooleanSchema = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0", ""])])
  .transform((value) => value === true || value === "true" || value === "1");

/**
 * Schema for listing notifications query parameters
 */
export const listNotificationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
  unreadOnly: queryBooleanSchema.optional().default(false),
});

export type ListNotificationsQuery = z.infer<
  typeof listNotificationsQuerySchema
>;

/**
 * Schema for creating a notification
 */
export const createNotificationSchema = z.object({
  notificationType: notificationTypeSchema,
  title: z.string().min(1).max(255),
  message: z.string().optional(),
  actionUrl: z
    .string()
    .max(2048)
    .regex(/^\/(?!\/)/, "Action URL must be a safe application-relative path")
    .refine(
      (value) => !/[\u0000-\u001f\u007f\\]/.test(value),
      "Action URL contains invalid characters",
    )
    .optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type CreateNotificationInput = z.infer<typeof createNotificationSchema>;
