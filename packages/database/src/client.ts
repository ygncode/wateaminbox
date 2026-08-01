import type {
  BulkJobAudience,
  BulkJobStatus,
  CompanyMemberRole,
  CompanyStatus,
  MessageStatus,
  MessageType,
  RemoteHistoryStatus,
  ScheduledMessageStatus,
} from "@wateaminbox/shared";
import { Generated, Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";

// ============================================================================
// Public Schema Database Types (multi-tenant management)
// ============================================================================

/**
 * Main database interface for public schema tables
 */
export interface Database {
  companies: CompaniesTable;
  users: UsersTable;
  company_members: CompanyMembersTable;
  invitations: InvitationsTable;
  company_stats: CompanyStatsTable;
  user_sessions: UserSessionsTable;
  auth_tokens: AuthTokensTable;
}

// Type alias for backward compatibility (deprecated - import from @wateaminbox/shared instead)
/** @deprecated Use CompanyMemberRole from @wateaminbox/shared instead */
export type MemberRole = CompanyMemberRole;

export interface CompaniesTable {
  id: Generated<string>;
  name: string;
  description: string | null;
  logo_key: string | null;
  schema_name: string;
  status: Generated<CompanyStatus>;
  max_whatsapp_connections: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface UsersTable {
  id: Generated<string>;
  name: string | null;
  email: string;
  avatar_key: string | null;
  password_hash: string;
  email_verified_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface CompanyMembersTable {
  id: Generated<string>;
  user_id: string;
  company_id: string;
  role: Generated<CompanyMemberRole>;
  permissions: Generated<Record<string, unknown>>;
  invited_by: string | null;
  joined_at: Generated<Date>;
}

export interface InvitationsTable {
  id: Generated<string>;
  company_id: string;
  email: string;
  role: Generated<Exclude<CompanyMemberRole, "owner">>;
  permissions: Generated<Record<string, unknown>>;
  token: string;
  invited_by: string;
  expires_at: Date;
  accepted_at: Date | null;
  created_at: Generated<Date>;
}

export interface CompanyStatsTable {
  company_id: string;
  total_messages: Generated<number>;
  total_contacts: Generated<number>;
  active_users: Generated<number>;
  last_message_at: Date | null;
  updated_at: Generated<Date>;
}

export interface UserSessionsTable {
  id: Generated<string>;
  user_id: string;
  device_name: string | null;
  device_type: string | null;
  ip_address: string | null;
  user_agent: string | null;
  /** SHA-256 hash of the current refresh token. */
  refresh_token: string;
  last_active_at: Generated<Date>;
  created_at: Generated<Date>;
  expires_at: Date;
}

export type AuthTokenType = "email_verification" | "password_reset";

export interface AuthTokensTable {
  id: Generated<string>;
  user_id: string;
  type: AuthTokenType;
  token_hash: string;
  expires_at: Date;
  used_at: Date | null;
  created_at: Generated<Date>;
}

// ============================================================================
// Tenant Schema Database Types (per-company data)
// ============================================================================

export type WhatsAppConnectionStatus =
  | "connected"
  | "connecting"
  | "disconnected"
  | "banned"
  | "pending"
  | "error";
export type NotificationType =
  | "message"
  | "mention"
  | "assignment"
  | "team"
  | "system";
export type ConversationStatus = "open" | "pending" | "resolved";
export type CatalogStatus = "active" | "inactive" | "archived";
export type ProductVisibility = "visible" | "hidden";

/**
 * Tenant database interface for tenant-specific tables
 */
export interface TenantDatabase {
  whatsapp_connections: WhatsAppConnectionsTable;
  whatsapp_connection_sessions: WhatsAppConnectionSessionsTable;
  contacts: ContactsTable;
  tags: TagsTable;
  whatsapp_labels: WhatsAppLabelsTable;
  whatsapp_catalogs: WhatsAppCatalogsTable;
  catalog_products: CatalogProductsTable;
  contact_tags: ContactTagsTable;
  contact_assignments: ContactAssignmentsTable;
  contact_notes_private: ContactNotesPrivateTable;
  contact_notes_shared: ContactNotesSharedTable;
  messages: TenantMessagesTable;
  message_reactions: MessageReactionsTable;
  groups: GroupsTable;
  group_participants: GroupParticipantsTable;
  status_updates: StatusUpdatesTable;
  audit_logs: AuditLogsTable;
  notification_preferences: NotificationPreferencesTable;
  notification_history: NotificationHistoryTable;
  push_subscriptions: PushSubscriptionsTable;
  quick_replies: QuickRepliesTable;
  conversation_states: ConversationStatesTable;
  nats_outbox: NatsOutboxTable;
  scheduled_messages: ScheduledMessagesTable;
  bulk_jobs: BulkJobsTable;
  bulk_connection_budgets: BulkConnectionBudgetsTable;
}

export interface WhatsAppConnectionsTable {
  id: Generated<string>;
  name: string | null;
  phone_number: string | null;
  jid: string | null;
  status: Generated<WhatsAppConnectionStatus>;
  connected_by: string | null;
  connected_at: Date | null;
  last_sync_at: Date | null;
  sync_status: "syncing" | "completed" | "interrupted" | null;
  sync_message_count: Generated<number>;
  sync_conversation_count: Generated<number>;
  qr_code: string | null;
  qr_expires_at: Date | null;
  archived_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export type WhatsAppConnectionSessionStatus =
  | "pending"
  | "connecting"
  | "connected"
  | "disconnected"
  | "ended";

export interface WhatsAppConnectionSessionsTable {
  id: Generated<string>;
  whatsapp_connection_id: string;
  status: Generated<WhatsAppConnectionSessionStatus>;
  created_by: string | null;
  expected_phone_number: string | null;
  started_at: Date | null;
  connected_at: Date | null;
  ended_at: Date | null;
  end_reason: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ContactsTable {
  id: Generated<string>;
  whatsapp_connection_id: string | null;
  jid: string | null;
  phone_number: string | null;
  push_name: string | null;
  custom_name: string | null;
  notes_shared: string | null;
  is_group: Generated<boolean>;
  is_online: Generated<boolean>;
  last_seen: Date | null;
  is_blocked: Generated<boolean>;
  profile_picture_url: string | null;
  remote_history_status: Generated<RemoteHistoryStatus>;
  remote_history_updated_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface TagsTable {
  id: Generated<string>;
  name: string;
  color: string | null;
  whatsapp_label_id: string | null;
  synced_at: Date | null;
  created_by: string | null;
  created_at: Generated<Date>;
}

export interface WhatsAppLabelsTable {
  id: Generated<string>;
  whatsapp_connection_id: string | null;
  label_id: string;
  name: string;
  color: string | null;
  predefined_id: number | null;
  synced_tag_id: string | null;
  last_synced_at: Generated<Date>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface WhatsAppCatalogsTable {
  id: Generated<string>;
  whatsapp_connection_id: string | null;
  catalog_id: string;
  name: string;
  description: string | null;
  currency: Generated<string>;
  status: Generated<CatalogStatus>;
  business_jid: string | null;
  header_image_url: string | null;
  product_count: Generated<number>;
  last_synced_at: Generated<Date>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface CatalogProductsTable {
  id: Generated<string>;
  whatsapp_connection_id: string | null;
  product_id: string;
  catalog_id: string;
  name: string;
  description: string | null;
  price: number | null;
  currency: Generated<string>;
  image_urls: string[] | null;
  sku: string | null;
  category: string | null;
  availability: Generated<string>;
  visibility: Generated<ProductVisibility>;
  url: string | null;
  retailer_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ContactTagsTable {
  contact_id: string;
  tag_id: string;
}

export interface ContactAssignmentsTable {
  id: Generated<string>;
  contact_id: string;
  assigned_to: string;
  assigned_by: string;
  assigned_at: Generated<Date>;
  unassigned_at: Date | null;
}

export interface ContactNotesPrivateTable {
  id: Generated<string>;
  contact_id: string;
  user_id: string;
  content: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ContactNotesSharedTable {
  id: Generated<string>;
  contact_id: string;
  user_id: string;
  author_name: string;
  content: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface TenantMessagesTable {
  id: Generated<string>;
  whatsapp_connection_id: string | null;
  contact_id: string | null;
  message_id: string | null;
  from_me: boolean;
  sender_jid: string | null;
  sender_name: string | null;
  sender_avatar_url: string | null;
  message_type: MessageType;
  content: string | null;
  media_url: string | null;
  media_mime_type: string | null;
  media_size: number | null;
  media_direct_path: string | null;
  media_key: Buffer | null;
  media_file_sha256: Buffer | null;
  media_file_enc_sha256: Buffer | null;
  media_download_status:
    | "pending"
    | "downloading"
    | "completed"
    | "failed"
    | null;
  media_download_error: string | null;
  media_downloaded_at: Date | null;
  quoted_message_id: string | null;
  is_forwarded: Generated<boolean>;
  is_starred: Generated<boolean>;
  deleted_by_sender: Generated<boolean>;
  deleted_at: Date | null;
  sent_by_user_id: string | null;
  status: Generated<MessageStatus>;
  metadata: Record<string, unknown> | null;
  timestamp: Date;
  created_at: Generated<Date>;
  search_vector: unknown | null;
}

export interface MessageReactionsTable {
  id: Generated<string>;
  message_id: string;
  reactor_jid: string;
  emoji: string;
  created_at: Generated<Date>;
}

export interface GroupsTable {
  id: Generated<string>;
  contact_id: string | null;
  jid: string | null;
  name: string | null;
  description: string | null;
  created_by: string | null;
  created_at: Generated<Date>;
  participant_count: Generated<number>;
}

export interface GroupParticipantsTable {
  id: Generated<string>;
  group_id: string;
  participant_jid: string;
  is_admin: Generated<boolean>;
  joined_at: Generated<Date>;
}

export interface StatusUpdatesTable {
  id: Generated<string>;
  whatsapp_connection_id: string | null;
  status_id: string | null;
  from_jid: string | null;
  media_type: string | null;
  media_url: string | null;
  caption: string | null;
  timestamp: Date;
  expires_at: Date;
}

export interface AuditLogsTable {
  id: Generated<string>;
  user_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: Generated<Date>;
}

export interface NotificationPreferencesTable {
  id: Generated<string>;
  user_id: string;
  sound_enabled: Generated<boolean>;
  sound_choice: Generated<string>;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  muted_contacts: Generated<string[]>;
  notifications_enabled: Generated<boolean>;
  timezone: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface NotificationHistoryTable {
  id: Generated<string>;
  user_id: string;
  notification_type: NotificationType;
  title: string;
  message: string | null;
  action_url: string | null;
  metadata: Record<string, unknown> | null;
  is_read: Generated<boolean>;
  read_at: Date | null;
  created_at: Generated<Date>;
}

export interface PushSubscriptionsTable {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  last_used_at: Date | null;
}

export interface QuickRepliesTable {
  id: Generated<string>;
  shortcut: string;
  title: string;
  content: string;
  created_by: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ConversationStatesTable {
  id: Generated<string>;
  contact_id: string;
  read_by_user_id: string | null;
  read_at: Date | null;
  last_message_at: Date | null;
  last_message_preview: string | null;
  unread_count: Generated<number>;
  status: Generated<ConversationStatus>;
  resolved_at: Date | null;
  resolved_by: string | null;
  reopened_at: Date | null;
  reopened_by: string | null;
  resolution_notes: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ScheduledMessagesTable {
  id: Generated<string>;
  contact_id: string;
  content: string;
  message_type: Generated<MessageType>;
  media_url: string | null;
  media_mime_type: string | null;
  media_file_name: string | null;
  reply_to_message_id: string | null;
  scheduled_at: Date;
  status: Generated<ScheduledMessageStatus>;
  attempts: Generated<number>;
  next_attempt_at: Date;
  last_error: string | null;
  sent_message_id: string | null;
  created_by: string;
  canceled_by: string | null;
  canceled_at: Date | null;
  sent_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  bulk_job_id: string | null;
  skip_reason: string | null;
}

export interface BulkJobsTable {
  id: Generated<string>;
  name: string;
  status: Generated<BulkJobStatus>;
  content: string;
  message_type: Generated<MessageType>;
  media_url: string | null;
  media_mime_type: string | null;
  media_file_name: string | null;
  audience: BulkJobAudience;
  audience_hash: string;
  scheduled_at: Date;
  total_recipients: Generated<number>;
  skipped_recipients: Generated<number>;
  idempotency_key: string | null;
  created_by: string;
  canceled_by: string | null;
  canceled_at: Date | null;
  completed_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/**
 * Global per-connection bulk send ledger. One row per WhatsApp connection;
 * the dispatcher locks it FOR UPDATE before claiming a bulk leaf so pacing
 * and the daily quota hold across all jobs and API replicas.
 */
export interface BulkConnectionBudgetsTable {
  whatsapp_connection_id: string;
  next_eligible_at: Generated<Date>;
  quota_date: Generated<Date>;
  sent_today: Generated<number>;
  updated_at: Generated<Date>;
}

export type NatsOutboxStatus = "pending" | "claimed" | "published" | "failed";

export interface NatsOutboxTable {
  id: Generated<string>;
  subject: string;
  payload: Record<string, unknown>;
  status: Generated<NatsOutboxStatus>;
  attempts: Generated<number>;
  next_attempt_at: Generated<Date>;
  last_error: string | null;
  created_at: Generated<Date>;
  published_at: Date | null;
}

// ============================================================================
// Database Connection Functions
// ============================================================================

/**
 * Creates a Kysely database instance for the public schema
 */
export function createDatabase(connectionString: string): Kysely<Database> {
  const dialect = new PostgresDialect({
    pool: new Pool({
      connectionString,
      max: 10,
    }),
  });

  return new Kysely<Database>({
    dialect,
  });
}

/**
 * Creates a Kysely database instance for a specific tenant schema
 */
export function createTenantDatabase(
  connectionString: string,
  schemaName: string,
): Kysely<TenantDatabase> {
  const dialect = new PostgresDialect({
    pool: new Pool({
      connectionString,
      max: 5,
    }),
  });

  const db = new Kysely<TenantDatabase>({
    dialect,
  });

  return db.withSchema(schemaName) as Kysely<TenantDatabase>;
}

/**
 * Generates a tenant schema name from a company ID
 */
export function getTenantSchemaName(companyId: string): string {
  return `tenant_${companyId.replace(/-/g, "_")}`;
}

// Default database instance using environment variable
export const db = createDatabase(process.env.DATABASE_URL || "");
