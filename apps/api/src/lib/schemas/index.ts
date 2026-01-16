/**
 * Centralized validation schemas
 *
 * This module re-exports all validation schemas for routes.
 * Each domain has its own schema file for organization.
 *
 * Usage:
 * ```ts
 * import { createQuickReplySchema, loginSchema } from '../lib/schemas/index.js'
 * // or import directly:
 * import { createQuickReplySchema } from '../lib/schemas/quick-replies.js'
 * ```
 */

// Auth
export {
  registerSchema,
  loginSchema,
  deviceInfoSchema,
  verifyEmailSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  refreshTokenSchema,
  type RegisterInput,
  type LoginInput,
  type VerifyEmailInput,
  type ForgotPasswordInput,
  type ResetPasswordInput,
  type RefreshTokenInput,
} from "./auth.js";

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

// Contact
export {
  createContactSchema,
  updateContactSchema,
  listContactsQuerySchema,
  createContactNoteSchema,
  updateContactNoteSchema,
  assignContactSchema,
  importContactsOptionsSchema,
  addContactTagSchema,
  type CreateContactInput,
  type UpdateContactInput,
  type ListContactsQuery,
  type CreateContactNoteInput,
  type UpdateContactNoteInput,
  type AssignContactInput,
  type ImportContactsOptions,
  type AddContactTagInput,
} from "./contact.js";

// Message
export {
  sendMessageSchema,
  forwardMessageSchema,
  listMessagesQuerySchema,
  addReactionSchema,
  batchStarSchema,
  batchDeleteSchema,
  batchMessageOperationSchema,
  type SendMessageInput,
  type ForwardMessageInput,
  type ListMessagesQuery,
  type AddReactionInput,
  type BatchStarInput,
  type BatchDeleteInput,
  type BatchMessageOperationInput,
} from "./message.js";

// Tag
export {
  createTagSchema,
  updateTagSchema,
  listTagsQuerySchema,
  type CreateTagInput,
  type UpdateTagInput,
  type ListTagsQuery,
} from "./tag.js";

// WhatsApp
export {
  sendMessageSchema as sendWhatsAppMessageSchema,
  type SendMessageInput as SendWhatsAppMessageInput,
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

// Group
export {
  listGroupsQuerySchema,
  updateGroupSchema,
  updateGroupSettingsSchema,
  type ListGroupsQuery,
  type UpdateGroupInput,
  type UpdateGroupSettingsInput,
} from "./group.js";

// Conversation
export {
  listConversationMessagesQuerySchema,
  sendConversationMessageSchema,
  resolveConversationSchema,
  resolutionTrendQuerySchema,
  type ListConversationMessagesQuery,
  type SendConversationMessageInput,
  type ResolveConversationInput,
  type ResolutionTrendQuery,
} from "./conversation.js";

// Status
export {
  postStatusSchema,
  type PostStatusInput,
} from "./status.js";
