/**
 * API Types
 * Shared type definitions for API requests and responses
 */

import type { Message } from "@wateaminbox/shared";

// Common types
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiResponse<T> {
  data: T;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    hasMore?: boolean;
  };
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  cursor?: string;
}

export interface MessageQueryParams extends PaginationParams {
  before?: string; // Message ID to fetch messages before
  after?: string; // Message ID to fetch messages after
}

// Auth types
export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  message: string;
  user: {
    id: string;
    email: string;
    name?: string;
    avatarUrl: string;
    gravatarUrl: string;
    hasCustomAvatar: boolean;
    emailVerified: boolean;
  };
  tokens: {
    accessToken: string;
  };
  session: {
    id: string;
    expiresAt: string;
  };
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
  companyName?: string;
}

export interface RegisterResponse {
  message: string;
  verificationEmailSent: boolean;
  user: {
    id: string;
    email: string;
    emailVerified: boolean;
    createdAt: string;
  };
}

export interface ResendVerificationResponse {
  message: string;
  alreadyVerified: boolean;
}

export interface RefreshResponse {
  message: string;
  tokens: {
    accessToken: string;
  };
}

export interface ForgotPasswordResponse {
  message: string;
}

export interface CurrentUserResponse {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string;
  gravatarUrl: string;
  hasCustomAvatar: boolean;
  emailVerified: boolean;
}

export interface UpdateProfileRequest {
  name?: string;
  email?: string;
  currentPassword?: string;
  avatarDataUrl?: string | null;
}

export interface UpdateProfileResponse {
  message: string;
  user: CurrentUserResponse;
  emailVerificationRequired: boolean;
  emailVerificationSent: boolean;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

// Contact types
export interface Contact {
  id: string;
  phoneNumber: string;
  jid?: string;
  name?: string;
  username?: string;
  customName?: string;
  avatarUrl?: string;
  isBlocked: boolean;
  isGroup?: boolean;
  isOnline?: boolean;
  lastSeen?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Conversation types
export interface Conversation {
  id: string;
  contactId: string;
  contact: Contact;
  lastMessage?: Message;
  unreadCount: number;
  isPinned: boolean;
  isMuted: boolean;
  assignedUserId?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Company types - re-export from shared package
export type {
  Company,
  CompanyInvitation,
  CompanyMember,
  CompanyMemberRole,
  CompanyStatus,
  CompanyWithRole,
  CreateCompanyInput,
  InviteMemberInput,
  UpdateCompanyInput,
} from "@wateaminbox/shared";

// Media types
export interface UploadMediaResponse {
  success: boolean;
  mediaUrl: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

// WhatsApp connection types
export interface WhatsAppConnectionStatus {
  status: "disconnected" | "pending" | "connected";
  phoneNumber?: string;
  jid?: string;
  connectedAt?: string;
  lastSync?: string;
}

export interface WhatsAppConnectResponse {
  message: string;
}

export type WhatsAppConnectionStatusType =
  | "disconnected"
  | "pending"
  | "connected"
  | "banned"
  | "error";

export interface WhatsAppConnection {
  id: string;
  name: string;
  status: WhatsAppConnectionStatusType;
  phoneNumber?: string;
  jid?: string;
  connectedAt?: string;
  lastSync?: string;
  qrCode?: string | null;
  qrExpiresAt?: string | null;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WhatsAppConnectionsListResponse {
  data: WhatsAppConnection[];
  meta: {
    total: number;
  };
}

export interface CreateWhatsAppConnectionResponse {
  data: WhatsAppConnection;
  message: string;
}

export interface WhatsAppConnectionDetailResponse {
  data: WhatsAppConnection;
}

// Contact import types
export interface ContactImportPreview {
  row: number;
  phoneNumber: string;
  name: string | null;
  notes: string | null;
  tags: string | null;
  exists: boolean;
  existingName: string | null;
}

/** Connection that imported contacts will be linked to */
export interface ContactImportConnection {
  id: string;
  name: string | null;
  phoneNumber: string | null;
}

export interface ContactImportPreviewResponse {
  total: number;
  existingCount: number;
  newCount: number;
  preview: ContactImportPreview[];
  connection: ContactImportConnection;
}

export interface ContactImportResult {
  row: number;
  phoneNumber: string;
  status: "created" | "updated" | "skipped" | "error";
  error?: string;
  contactId?: string;
}

export interface ContactImportResponse {
  success: boolean;
  summary: {
    total: number;
    created: number;
    updated: number;
    skipped: number;
    errors: number;
  };
  results: ContactImportResult[];
  connection: ContactImportConnection;
}

// Analytics types
export interface ResponseTimeStatsCore {
  averageResponseTimeMinutes: number;
  medianResponseTimeMinutes: number;
  maxResponseTimeMinutes: number;
  minResponseTimeMinutes: number;
  totalConversations: number;
  withinSlaCount: number;
  slaComplianceRate: number;
  /** Unanswered episodes excluded via a valid response-SLA exclusion outcome (no_reply_needed/spam/duplicate) - never counted compliant. */
  excludedCount: number;
}

export interface ResponseTimeStats extends ResponseTimeStatsCore {
  byKind: {
    direct: ResponseTimeStatsCore;
    group: ResponseTimeStatsCore;
  };
}

export interface ResponseTimeByDate {
  date: string;
  averageResponseTimeMinutes: number;
  conversationCount: number;
  slaComplianceRate: number;
}

export interface TeamResponseTimeStats {
  userId: string;
  email: string;
  averageResponseTimeMinutes: number;
  totalResponses: number;
  slaComplianceRate: number;
}

export interface SlaBreach {
  contactId: string;
  contactName: string | null;
  inboundMessageTime: string;
  responseTime: string | null;
  responseMinutes: number;
  respondedBy: string | null;
}

// Resolution (case-cycle) analytics types
export interface CaseResolutionStatsCore {
  totalResolvedCases: number;
  averageResolutionMinutes: number;
  medianResolutionMinutes: number;
  withinSlaCount: number;
  /** resolved-in-range count + currently-overdue-active count - the compliance denominator. */
  totalEvaluated: number;
  slaComplianceRate: number;
  overdueActiveCases: number;
}

export interface CaseResolutionStats extends CaseResolutionStatsCore {
  byKind: {
    direct: CaseResolutionStatsCore;
    group: CaseResolutionStatsCore;
  };
}

export interface CaseResolutionTrendPoint {
  date: string;
  resolvedCount: number;
  averageResolutionMinutes: number;
  slaComplianceRate: number;
}

export interface TeamCaseResolutionStats {
  userId: string;
  email: string;
  totalResolvedCases: number;
  averageResolutionMinutes: number;
  slaComplianceRate: number;
}

export interface OverdueCase {
  caseId: string;
  contactId: string;
  contactName: string | null;
  kind: "direct" | "group";
  status: "open" | "pending";
  openedAt: string;
  elapsedMinutes: number;
  resolutionTargetMinutes: number;
}

// Notification types
export type SoundChoice = "default" | "chime" | "bell" | "pop" | "none";

export interface NotificationPreferencesResponse {
  id: string;
  userId: string;
  notificationsEnabled: boolean;
  timezone: string | null;
  soundEnabled: boolean;
  soundChoice: SoundChoice;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  mutedContacts: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UpdateNotificationPreferencesInput {
  notificationsEnabled?: boolean;
  timezone?: string | null;
  soundEnabled?: boolean;
  soundChoice?: SoundChoice;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
  mutedContacts?: string[];
}

export type NotificationType =
  | "message"
  | "mention"
  | "assignment"
  | "team"
  | "system";

export interface InAppNotification {
  id: string;
  userId: string;
  notificationType: NotificationType;
  title: string;
  message: string | null;
  actionUrl: string | null;
  metadata: Record<string, unknown> | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationListParams {
  limit?: number;
  offset?: number;
  unreadOnly?: boolean;
}

export interface NotificationListResponse {
  data: InAppNotification[];
  meta: {
    total: number;
    unreadCount: number;
    limit: number;
    offset: number;
  };
}

export interface PushStatusResponse {
  configured: boolean;
  subscribed: boolean;
  publicKey: string | null;
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface CreateNotificationInput {
  notificationType: NotificationType;
  title: string;
  message?: string;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
}

// Quick reply types
export interface QuickReply {
  id: string;
  shortcut: string;
  title: string;
  content: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface QuickReplyListParams {
  search?: string;
  limit?: number;
  offset?: number;
}

export interface CreateQuickReplyInput {
  shortcut: string;
  title: string;
  content: string;
}

export interface UpdateQuickReplyInput {
  shortcut?: string;
  title?: string;
  content?: string;
}

export interface QuickReplyListResponse {
  data: QuickReply[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

// Label types
export interface WhatsAppLabel {
  id: string;
  connectionId: string | null;
  labelId: string;
  name: string;
  color: string | null;
  predefinedId: number | null;
  syncedTagId: string | null;
  lastSyncedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface LabelSyncStatus {
  totalLabels: number;
  linkedLabels: number;
  unlinkedLabels: number;
  totalTags: number;
  linkedTags: number;
  lastSyncAt: string | null;
}

export interface TagWithLabelStatus {
  id: string;
  name: string;
  color: string | null;
  createdBy: string | null;
  createdAt: string;
  whatsappLabelId: string | null;
  syncedAt: string | null;
  linkedLabel: {
    labelId: string;
    name: string;
    color: string | null;
  } | null;
}

export interface LabelListResponse {
  data: WhatsAppLabel[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export interface TagsWithStatusResponse {
  data: TagWithLabelStatus[];
}

export interface SyncLabelsResponse {
  message: string;
  status: string;
}

export interface LinkTagResponse {
  message: string;
}

export interface AutoCreateTagsResponse {
  message: string;
  created: number;
  linked: number;
}

// Catalog types
export type CatalogStatus = "active" | "inactive" | "archived";
export type ProductVisibility = "visible" | "hidden";

export interface WhatsAppCatalog {
  id: string;
  connectionId: string | null;
  catalogId: string;
  name: string;
  description: string | null;
  currency: string;
  status: CatalogStatus;
  businessJid: string | null;
  headerImageUrl: string | null;
  productCount: number;
  lastSyncedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogProduct {
  id: string;
  connectionId: string | null;
  productId: string;
  catalogId: string;
  name: string;
  description: string | null;
  price: number | null;
  currency: string;
  imageUrls: string[] | null;
  sku: string | null;
  category: string | null;
  availability: string;
  visibility: ProductVisibility;
  url: string | null;
  retailerId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogSyncStatus {
  totalCatalogs: number;
  activeCatalogs: number;
  totalProducts: number;
  lastSyncAt: string | null;
}

export interface CatalogListResponse {
  data: WhatsAppCatalog[];
}

export interface CatalogProductsResponse {
  products: CatalogProduct[];
  meta: {
    catalogId: string;
    catalogName: string;
    totalProducts: number;
  };
}

export interface SyncCatalogsResponse {
  message: string;
  status: string;
  catalogId?: string;
}

export interface CatalogActionResponse {
  message: string;
}
