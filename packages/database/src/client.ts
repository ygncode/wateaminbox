import { Kysely, PostgresDialect, Generated } from "kysely";
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
}

export type CompanyStatus = "active" | "suspended" | "deleted";
export type MemberRole = "owner" | "admin" | "member";

export interface CompaniesTable {
  id: Generated<string>;
  name: string;
  schema_name: string;
  status: Generated<CompanyStatus>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface UsersTable {
  id: Generated<string>;
  email: string;
  password_hash: string;
  email_verified_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface CompanyMembersTable {
  id: Generated<string>;
  user_id: string;
  company_id: string;
  role: Generated<MemberRole>;
  permissions: Generated<Record<string, unknown>>;
  invited_by: string | null;
  joined_at: Generated<Date>;
}

export interface InvitationsTable {
  id: Generated<string>;
  company_id: string;
  email: string;
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
  refresh_token: string;
  last_active_at: Generated<Date>;
  created_at: Generated<Date>;
  expires_at: Date;
}

// ============================================================================
// Tenant Schema Database Types (per-company data)
// ============================================================================

export type WhatsAppConnectionStatus = "connected" | "disconnected" | "banned" | "pending";
export type MessageType = "text" | "image" | "video" | "audio" | "document" | "sticker" | "location" | "contact" | "reaction";
export type MessageStatus = "pending" | "sent" | "delivered" | "read" | "failed";
export type NotificationType = "message" | "mention" | "assignment" | "team" | "system";
export type ConversationStatus = "open" | "pending" | "resolved";

/**
 * Tenant database interface for tenant-specific tables
 */
export interface TenantDatabase {
  whatsapp_connections: WhatsAppConnectionsTable;
  contacts: ContactsTable;
  tags: TagsTable;
  whatsapp_labels: WhatsAppLabelsTable;
  contact_tags: ContactTagsTable;
  contact_assignments: ContactAssignmentsTable;
  contact_notes_private: ContactNotesPrivateTable;
  messages: TenantMessagesTable;
  message_reactions: MessageReactionsTable;
  groups: GroupsTable;
  group_participants: GroupParticipantsTable;
  status_updates: StatusUpdatesTable;
  audit_logs: AuditLogsTable;
  notification_preferences: NotificationPreferencesTable;
  notification_history: NotificationHistoryTable;
  quick_replies: QuickRepliesTable;
  conversation_states: ConversationStatesTable;
}

export interface WhatsAppConnectionsTable {
  id: Generated<string>;
  phone_number: string | null;
  jid: string | null;
  status: Generated<WhatsAppConnectionStatus>;
  connected_by: string | null;
  connected_at: Date | null;
  last_sync_at: Date | null;
  session_data: Buffer | null;
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
  profile_picture_url: string | null;
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
  label_id: string;
  name: string;
  color: string | null;
  predefined_id: number | null;
  synced_tag_id: string | null;
  last_synced_at: Generated<Date>;
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

export interface TenantMessagesTable {
  id: Generated<string>;
  whatsapp_connection_id: string | null;
  contact_id: string | null;
  message_id: string | null;
  from_me: boolean;
  sender_jid: string | null;
  message_type: MessageType;
  content: string | null;
  media_url: string | null;
  media_mime_type: string | null;
  media_size: number | null;
  quoted_message_id: string | null;
  is_forwarded: Generated<boolean>;
  is_starred: Generated<boolean>;
  deleted_by_sender: Generated<boolean>;
  deleted_at: Date | null;
  sent_by_user_id: string | null;
  status: Generated<MessageStatus>;
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
  muted_contacts: string[] | null;
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
  status: Generated<ConversationStatus>;
  resolved_at: Date | null;
  resolved_by: string | null;
  reopened_at: Date | null;
  reopened_by: string | null;
  resolution_notes: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
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
  schemaName: string
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
