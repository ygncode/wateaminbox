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
  type ChangePasswordInput,
  changePasswordSchema,
  deviceInfoSchema,
  type ForgotPasswordInput,
  forgotPasswordSchema,
  type LoginInput,
  loginSchema,
  type RefreshTokenInput,
  type RegisterInput,
  type ResendVerificationInput,
  type ResetPasswordInput,
  refreshTokenSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  type UpdateProfileInput,
  updateProfileSchema,
  type VerifyEmailInput,
  verifyEmailSchema,
} from "./auth.js";
// Bulk broadcast jobs
export {
  type BulkAudienceInput,
  bulkAudienceSchema,
  type CreateBulkJobInput,
  createBulkJobSchema,
  type ListBulkJobRecipientsQuery,
  type ListBulkJobsQuery,
  listBulkJobRecipientsQuerySchema,
  listBulkJobsQuerySchema,
  type PreviewBulkJobInput,
  previewBulkJobSchema,
  type RescheduleBulkJobInput,
  rescheduleBulkJobSchema,
} from "./bulk-job.js";
// Company
export {
  type CreateCompanyInput,
  createCompanySchema,
  type InviteMemberInput,
  inviteMemberSchema,
  type ListCompanyInvitationsQuery,
  type ListCompanyMembersQuery,
  listCompanyInvitationsQuerySchema,
  listCompanyMembersQuerySchema,
  type UpdateCompanyInput,
  type UpdateMemberPermissionsInput,
  type UpdateMemberRoleInput,
  updateCompanySchema,
  updateMemberPermissionsSchema,
  updateMemberRoleSchema,
} from "./company.js";
// Contact
export {
  type AddContactTagInput,
  type AssignContactInput,
  addContactTagSchema,
  assignContactSchema,
  type CreateContactInput,
  type CreateContactNoteInput,
  createContactNoteSchema,
  createContactSchema,
  type ImportContactsOptions,
  importContactsOptionsSchema,
  type ListContactsQuery,
  listContactsQuerySchema,
  type UpdateContactInput,
  type UpdateContactNoteInput,
  updateContactNoteSchema,
  updateContactSchema,
} from "./contact.js";
// Conversation
export {
  type ListConversationMessagesQuery,
  listConversationMessagesQuerySchema,
  type OpenConversationInput,
  openConversationSchema,
  type ResolutionTrendQuery,
  type ResolveConversationInput,
  resolutionOutcomeSchema,
  resolutionTrendQuerySchema,
  resolveConversationSchema,
  type SendConversationMessageInput,
  sendConversationMessageSchema,
} from "./conversation.js";
// Group
export {
  type CreateGroupInput,
  createGroupSchema,
  type GroupInviteLinkInput,
  type GroupJoinRequestDecisionInput,
  type GroupParticipantsInput,
  groupInviteLinkSchema,
  groupJoinRequestDecisionSchema,
  groupParticipantsSchema,
  type ListGroupsQuery,
  listGroupsQuerySchema,
  participantJidSchema,
  type UpdateGroupInput,
  type UpdateGroupSettingsInput,
  updateGroupSchema,
  updateGroupSettingsSchema,
} from "./group.js";
// Message
export {
  type AddReactionInput,
  addReactionSchema,
  type BatchDeleteInput,
  type BatchMessageOperationInput,
  type BatchStarInput,
  batchDeleteSchema,
  batchMessageOperationSchema,
  batchStarSchema,
  type ForwardMessageInput,
  forwardMessageSchema,
  type ListMessagesQuery,
  type ListScheduledMessagesQuery,
  listMessagesQuerySchema,
  listScheduledMessagesQuerySchema,
  SCHEDULABLE_MEDIA_TYPES,
  SCHEDULE_MAX_HORIZON_MS,
  SCHEDULE_MIN_LEAD_MS,
  type ScheduleMessageInput,
  type SendMessageInput,
  scheduleMessageSchema,
  sendMessageSchema,
} from "./message.js";
// Note
export { type NoteContentInput, noteContentSchema } from "./note.js";
// Notifications
export {
  type CreateNotificationInput,
  createNotificationSchema,
  type ListNotificationsQuery,
  listNotificationsQuerySchema,
  type MuteContactInput,
  muteContactSchema,
  notificationTypeSchema,
  soundChoiceSchema,
  type UpdatePreferencesInput,
  updatePreferencesSchema,
} from "./notification.js";
export {
  deletePushSubscriptionSchema,
  pushSubscriptionSchema,
} from "./push-subscription.js";
// Quick Replies
export {
  type CreateQuickReplyInput,
  createQuickReplySchema,
  type ListQuickRepliesQuery,
  listQuickRepliesQuerySchema,
  type UpdateQuickReplyInput,
  updateQuickReplySchema,
} from "./quick-replies.js";
// SLA policy
export {
  type CreateSlaPolicyInput,
  createSlaPolicySchema,
  exceptionsSchema,
  targetMinutesSchema,
  timezoneSchema,
  weeklyScheduleSchema,
} from "./sla-policy.js";

// API token
export {
  apiTokenScopeSchema,
  type CreateApiTokenInput,
  createApiTokenSchema,
  type ListApiTokensQuery,
  listApiTokensQuerySchema,
} from "./api-token.js";
// Status
export {
  type PostStatusInput,
  postStatusSchema,
} from "./status.js";
// Tag
export {
  type CreateTagInput,
  createTagSchema,
  type ListTagsQuery,
  listTagsQuerySchema,
  type UpdateTagInput,
  updateTagSchema,
} from "./tag.js";
// WhatsApp
export {
  type SendMessageInput as SendWhatsAppMessageInput,
  sendMessageSchema as sendWhatsAppMessageSchema,
} from "./whatsapp.js";
