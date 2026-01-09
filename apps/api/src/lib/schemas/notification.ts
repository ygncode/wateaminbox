import { z } from "zod";

/**
 * Sound choice for notifications
 */
export const soundChoiceSchema = z.enum(["default", "chime", "bell", "pop", "none"]);

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
  mutedContacts: z.array(z.string()).optional(),
});

export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;

/**
 * Schema for muting a contact
 */
export const muteContactSchema = z.object({
  contactJid: z.string().min(1),
});

export type MuteContactInput = z.infer<typeof muteContactSchema>;

/**
 * Schema for listing notifications query parameters
 */
export const listNotificationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
  unreadOnly: z.coerce.boolean().optional().default(false),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

/**
 * Schema for creating a notification
 */
export const createNotificationSchema = z.object({
  notificationType: notificationTypeSchema,
  title: z.string().min(1).max(255),
  message: z.string().optional(),
  actionUrl: z.string().url().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type CreateNotificationInput = z.infer<typeof createNotificationSchema>;
