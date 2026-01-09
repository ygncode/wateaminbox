/**
 * Centralized validation schemas
 *
 * This module re-exports all validation schemas for routes.
 * Each domain has its own schema file for organization.
 *
 * Usage:
 * ```ts
 * import { createQuickReplySchema } from '../lib/schemas/index.js'
 * // or import directly:
 * import { createQuickReplySchema } from '../lib/schemas/quick-replies.js'
 * ```
 */

// Company
export {
  createCompanySchema,
  updateCompanySchema,
  updateMemberRoleSchema,
  inviteMemberSchema,
  updateMemberPermissionsSchema,
  type CreateCompanyInput,
  type UpdateCompanyInput,
  type UpdateMemberRoleInput,
  type InviteMemberInput,
  type UpdateMemberPermissionsInput,
} from "./company.js";

// WhatsApp
export {
  sendMessageSchema,
  type SendMessageInput,
} from "./whatsapp.js";

// Notifications
export {
  soundChoiceSchema,
  notificationTypeSchema,
  updatePreferencesSchema,
  muteContactSchema,
  listNotificationsQuerySchema,
  createNotificationSchema,
  type UpdatePreferencesInput,
  type MuteContactInput,
  type ListNotificationsQuery,
  type CreateNotificationInput,
} from "./notification.js";

// Quick Replies
export {
  createQuickReplySchema,
  updateQuickReplySchema,
  listQuickRepliesQuerySchema,
  type CreateQuickReplyInput,
  type UpdateQuickReplyInput,
  type ListQuickRepliesQuery,
} from "./quick-replies.js";
