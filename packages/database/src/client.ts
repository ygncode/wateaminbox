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
  api_rate_limit_buckets: ApiRateLimitBucketsTable;
  companies: CompaniesTable;
  users: UsersTable;
  company_members: CompanyMembersTable;
  invitations: InvitationsTable;
  company_stats: CompanyStatsTable;
  user_sessions: UserSessionsTable;
  auth_tokens: AuthTokensTable;
  api_tokens: ApiTokensTable;
  oauth_clients: OAuthClientsTable;
  oauth_grants: OAuthGrantsTable;
  oauth_authorization_codes: OAuthAuthorizationCodesTable;
  sla_policies: SlaPoliciesTable;
  channel_spine_workspace_flags: ChannelSpineWorkspaceFlagsTable;
  channel_spine_workspace_flag_audit: ChannelSpineWorkspaceFlagAuditTable;
  channel_ingress_routes: ChannelIngressRoutesTable;
  channel_message_delivery_outbox: ChannelMessageDeliveryOutboxTable;
}

// Type alias for backward compatibility (deprecated - import from @wateaminbox/shared instead)
/** @deprecated Use CompanyMemberRole from @wateaminbox/shared instead */
export type MemberRole = CompanyMemberRole;

export interface ApiRateLimitBucketsTable {
  bucket_key: string;
  request_count: string;
  window_started_at: Date;
  expires_at: Date;
}

export type ChannelSpineWriteAuthority = "legacy" | "neutral";

export interface ChannelSpineWorkspaceFlagsTable {
  company_id: string;
  dual_write_enabled: Generated<boolean>;
  dual_write_revision: string | null;
  neutral_reads_enabled: Generated<boolean>;
  neutral_read_revision: string | null;
  shadow_normalization_enabled: Generated<boolean>;
  shadow_normalization_revision: string | null;
  write_authority: Generated<ChannelSpineWriteAuthority>;
  write_authority_revision: string | null;
  enabled_providers: Generated<string[]>;
  provider_enable_revision: string | null;
  revision: Generated<string>;
  created_by: string;
  updated_by: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ChannelSpineWorkspaceFlagAuditTable {
  company_id: string;
  revision: string;
  changed_by: string;
  changed_at: Generated<Date>;
  previous_flags: unknown | null;
  new_flags: unknown;
}

export type ChannelIngressRouteState = "pending" | "active" | "revoked";

export interface ChannelIngressRoutesTable {
  id: Generated<string>;
  provider: string;
  route_key_hash: string;
  company_id: string;
  channel_account_id: string;
  state: Generated<ChannelIngressRouteState>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  revoked_at: Date | null;
}

export type ChannelFanoutKind = "realtime" | "push";

export interface ChannelMessageDeliveryOutboxTable {
  company_id: string;
  channel_account_id: string;
  conversation_id: string;
  message_id: string;
  kind: ChannelFanoutKind;
  case_event: unknown | null;
  attempts: Generated<number>;
  next_attempt_at: Generated<Date>;
  created_at: Generated<Date>;
}

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

/**
 * Versioned, immutable SLA response-target policies for a company.
 * `weekly_schedule`/`exceptions` are stored as jsonb; application code casts
 * them to their typed shapes (see `SlaWeeklySchedule`/`SlaScheduleException`
 * in @wateaminbox/shared) on read, matching the existing `permissions`
 * jsonb-column pattern below.
 */
export interface SlaPoliciesTable {
  id: Generated<string>;
  company_id: string;
  /** Direct-chat response target (kept unrenamed for compatibility with pre-061 code/data). */
  target_minutes: number;
  timezone: string;
  weekly_schedule: unknown;
  exceptions: Generated<unknown>;
  effective_from: Date;
  created_by: string | null;
  created_at: Generated<Date>;
  direct_resolution_target_minutes: number;
  group_response_target_minutes: number;
  group_resolution_target_minutes: number;
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

export type ApiTokenScope = "read" | "write";

export interface ApiTokensTable {
  id: Generated<string>;
  user_id: string;
  company_id: string;
  name: string;
  /** SHA-256 hash of the raw token; the raw value is never persisted. */
  token_hash: string;
  /** First characters of the raw token, kept for display in token lists. */
  token_prefix: string;
  scopes: ApiTokenScope[];
  last_used_at: Date | null;
  expires_at: Date | null;
  revoked_at: Date | null;
  created_at: Generated<Date>;
  /** Set when this token was issued by the OAuth flow; null for a personal token. */
  grant_id: string | null;
  /** SHA-256 of the refresh token paired with this access token. */
  refresh_token_hash: string | null;
  refresh_expires_at: Date | null;
  /** Set when the refresh token was exchanged; a second use burns the grant. */
  refresh_used_at: Date | null;
}

/**
 * Cached client metadata document (CIMD). A client identifies itself by the
 * https URL of its document, which we fetch rather than registering.
 */
export interface OAuthClientsTable {
  id: Generated<string>;
  client_id: string;
  client_name: string | null;
  redirect_uris: string[];
  token_endpoint_auth_method: Generated<string>;
  metadata: unknown;
  fetched_at: Generated<Date>;
  cache_expires_at: Date;
  created_at: Generated<Date>;
}

/**
 * One authorization decision by one user for one client against one workspace.
 * Every access and refresh token in the rotation chain points back here, so
 * revoking the grant revokes the chain.
 */
export interface OAuthGrantsTable {
  id: Generated<string>;
  user_id: string;
  company_id: string;
  client_id: string;
  scopes: ApiTokenScope[];
  /** RFC 8707 resource the tokens are audience-bound to. */
  resource: string;
  created_at: Generated<Date>;
  last_used_at: Date | null;
  revoked_at: Date | null;
  revoked_reason: string | null;
}

/** Single-use authorization code carrying its PKCE challenge. */
export interface OAuthAuthorizationCodesTable {
  id: Generated<string>;
  code_hash: string;
  client_id: string;
  user_id: string;
  company_id: string;
  scopes: ApiTokenScope[];
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  resource: string;
  expires_at: Date;
  consumed_at: Date | null;
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
  channel_accounts: ChannelAccountsTable;
  channel_account_credentials: ChannelAccountCredentialsTable;
  contact_endpoints: ContactEndpointsTable;
  endpoint_account_states: EndpointAccountStatesTable;
  endpoint_presence: EndpointPresenceTable;
  contact_suppressions: ContactSuppressionsTable;
  conversations: ConversationsTable;
  conversation_notes: ConversationNotesTable;
  conversation_sync_states: ConversationSyncStatesTable;
  conversation_participants: ConversationParticipantsTable;
  message_participants: MessageParticipantsTable;
  message_attachments: MessageAttachmentsTable;
  whatsapp_attachment_fetch_state: WhatsAppAttachmentFetchStateTable;
  message_delivery_events: MessageDeliveryEventsTable;
  channel_event_inbox: ChannelEventInboxTable;
  outbound_message_intents: OutboundMessageIntentsTable;
  outbound_intent_attachments: OutboundIntentAttachmentsTable;
  channel_account_capabilities: ChannelAccountCapabilitiesTable;
  conversation_tags: ConversationTagsTable;
  contact_merge_events: ContactMergeEventsTable;
  contact_endpoint_reassignment_events: ContactEndpointReassignmentEventsTable;
  channel_spine_reconciliation_journal: ChannelSpineReconciliationJournalTable;
  channel_spine_backfill_checkpoints: ChannelSpineBackfillCheckpointsTable;
  connection_email_alerts: ConnectionEmailAlertsTable;
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
  group_join_requests: GroupJoinRequestsTable;
  status_updates: StatusUpdatesTable;
  audit_logs: AuditLogsTable;
  notification_preferences: NotificationPreferencesTable;
  notification_history: NotificationHistoryTable;
  push_subscriptions: PushSubscriptionsTable;
  quick_replies: QuickRepliesTable;
  auto_reply_settings: AutoReplySettingsTable;
  conversation_states: ConversationStatesTable;
  conversation_cases: ConversationCasesTable;
  nats_outbox: NatsOutboxTable;
  scheduled_messages: ScheduledMessagesTable;
  bulk_jobs: BulkJobsTable;
  bulk_connection_budgets: BulkConnectionBudgetsTable;
  purge_cleanup_items: PurgeCleanupItemsTable;
}

export type ChannelAccountStatus =
  | "connecting"
  | "connected"
  | "degraded"
  | "disconnected"
  | "disabled"
  | "error"
  | "archived";

export interface ChannelAccountsTable {
  id: Generated<string>;
  channel: string;
  provider: string;
  display_name: string | null;
  external_account_id: string | null;
  external_scope_id: string | null;
  status: Generated<ChannelAccountStatus>;
  provider_status: string | null;
  capabilities_revision: string | null;
  provider_metadata: Generated<Record<string, unknown>>;
  legacy_whatsapp_connection_id: string | null;
  connected_by: string | null;
  connected_at: Date | null;
  last_sync_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  archived_at: Date | null;
}

export interface ChannelAccountCredentialsTable {
  channel_account_id: string;
  credential_kind: string;
  encrypted_value: Buffer;
  nonce: Buffer;
  auth_tag: Buffer;
  key_version: string;
  created_at: Generated<Date>;
  rotated_at: Generated<Date>;
}

export interface ContactEndpointsTable {
  id: Generated<string>;
  contact_id: string | null;
  channel: string;
  provider: string;
  channel_account_id: string | null;
  endpoint_kind: string;
  external_id: string;
  identity_scope: string;
  normalized_address: string | null;
  address_display: string | null;
  display_name: string | null;
  verification_state: Generated<
    "unverified" | "provider_verified" | "user_verified" | "invalid"
  >;
  provider_metadata: Generated<Record<string, unknown>>;
  first_seen_at: Generated<Date>;
  last_seen_at: Generated<Date>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface EndpointAccountStatesTable {
  channel_account_id: string;
  contact_endpoint_id: string;
  provider_block_state: Generated<"unknown" | "allowed" | "blocked">;
  provider_status: string | null;
  updated_at: Generated<Date>;
}

export interface EndpointPresenceTable {
  channel_account_id: string;
  contact_endpoint_id: string;
  availability: Generated<
    "unknown" | "offline" | "online" | "away" | "unavailable"
  >;
  last_seen_at: Date | null;
  observed_at: Generated<Date>;
  expires_at: Date | null;
}

export interface ContactSuppressionsTable {
  id: Generated<string>;
  contact_id: string;
  scope: string;
  reason: string;
  created_by: string;
  created_at: Generated<Date>;
  revoked_at: Date | null;
}

export interface ConversationsTable {
  id: Generated<string>;
  channel_account_id: string;
  external_thread_id: string | null;
  client_thread_key: string;
  kind: "direct" | "group" | "thread";
  subject: string | null;
  provider_status: string | null;
  provider_metadata: Generated<Record<string, unknown>>;
  legacy_contact_id: string | null;
  first_message_at: Date | null;
  last_message_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  archived_at: Date | null;
}

export interface ConversationNotesTable {
  id: Generated<string>;
  conversation_id: string;
  author_user_id: string;
  visibility: "shared" | "private";
  content: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ConversationSyncStatesTable {
  conversation_id: string;
  provider: string;
  status: string;
  cursor_or_anchor: string | null;
  request_generation: Generated<string>;
  last_requested_at: Date | null;
  last_completed_at: Date | null;
  error_code: string | null;
  updated_at: Generated<Date>;
}

export interface ConversationParticipantsTable {
  id: Generated<string>;
  conversation_id: string;
  contact_endpoint_id: string | null;
  workspace_user_id: string | null;
  participant_kind: "external" | "workspace_user" | "account";
  role: string;
  is_self: Generated<boolean>;
  joined_at: Date | null;
  left_at: Date | null;
  provider_metadata: Generated<Record<string, unknown>>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface MessageParticipantsTable {
  message_id: string;
  ordinal: number;
  role: "from" | "sender" | "reply_to" | "to" | "cc" | "bcc";
  contact_endpoint_id: string | null;
  address_snapshot: string;
  display_name_snapshot: string | null;
  provider_metadata: Generated<Record<string, unknown>>;
}

export interface MessageAttachmentsTable {
  id: Generated<string>;
  message_id: string;
  ordinal: number;
  kind: string;
  provider_attachment_id: string | null;
  file_name: string | null;
  content_type: string | null;
  byte_size: string | null;
  storage_uri: string | null;
  provider_locator: Record<string, unknown> | null;
  content_id: string | null;
  content_disposition: string | null;
  status: Generated<"pending" | "available" | "failed" | "deleted">;
  error_code: string | null;
  provider_metadata: Generated<Record<string, unknown>>;
  fetch_attempts: Generated<number>;
  next_fetch_at: Generated<Date>;
  fetch_lease_token: string | null;
  fetch_lease_expires_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface WhatsAppAttachmentFetchStateTable {
  attachment_id: string;
  direct_path: string | null;
  media_key: Buffer | null;
  file_sha256: Buffer | null;
  file_enc_sha256: Buffer | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface MessageDeliveryEventsTable {
  id: Generated<string>;
  channel_account_id: string;
  message_id: string;
  recipient_endpoint_id: string | null;
  external_event_scope: string | null;
  external_event_id: string | null;
  status: string;
  provider_occurred_at: Date | null;
  ingested_at: Generated<Date>;
  error_code: string | null;
  error_detail: string | null;
  provider_metadata: Generated<Record<string, unknown>>;
}

export interface ChannelEventInboxTable {
  channel_account_id: string;
  external_event_scope: string;
  external_event_id: string;
  kind: string;
  payload_digest: string;
  normalized_event: Record<string, unknown>;
  status: Generated<"pending" | "applied" | "quarantined">;
  attempts: Generated<number>;
  next_attempt_at: Generated<Date>;
  last_error_code: string | null;
  received_at: Generated<Date>;
  applied_at: Date | null;
}

export interface OutboundMessageIntentsTable {
  id: Generated<string>;
  channel_account_id: string;
  conversation_id: string;
  message_id: string | null;
  scheduled_message_id: string | null;
  operation: string;
  idempotency_key: string;
  request_fingerprint: string;
  normalized_payload: Record<string, unknown>;
  status: Generated<
    | "pending"
    | "dispatching"
    | "handed_off"
    | "confirmed"
    | "failed"
    | "uncertain"
  >;
  attempts: Generated<number>;
  next_attempt_at: Generated<Date>;
  lease_token: string | null;
  lease_expires_at: Date | null;
  provider_request_id: string | null;
  last_error_code: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface OutboundIntentAttachmentsTable {
  intent_id: string;
  ordinal: number;
  storage_uri: string;
  file_name: string | null;
  content_type: string | null;
  byte_size: string | null;
  provider_metadata: Generated<Record<string, unknown>>;
}

export interface ChannelAccountCapabilitiesTable {
  channel_account_id: string;
  capability_key: string;
  support_state: "supported" | "unsupported" | "conditional";
  configuration: Generated<Record<string, unknown>>;
  revision: string;
  observed_at: Date;
  updated_at: Generated<Date>;
}

export interface ConversationTagsTable {
  conversation_id: string;
  tag_id: string;
}

export interface ContactMergeEventsTable {
  id: Generated<string>;
  source_contact_id: string;
  target_contact_id: string;
  actor_user_id: string;
  reason: string;
  endpoint_snapshot: unknown[];
  created_at: Generated<Date>;
}

export interface ContactEndpointReassignmentEventsTable {
  id: Generated<string>;
  merge_event_id: string | null;
  contact_endpoint_id: string;
  previous_contact_id: string | null;
  new_contact_id: string | null;
  actor_user_id: string;
  reason: string;
  created_at: Generated<Date>;
}

export interface ChannelSpineReconciliationJournalTable {
  id: Generated<string>;
  kind: string;
  legacy_table: string;
  legacy_id: string;
  error_code: string;
  detail: Generated<Record<string, unknown>>;
  status: Generated<"pending" | "repaired" | "quarantined">;
  attempts: Generated<number>;
  next_attempt_at: Generated<Date>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ChannelSpineBackfillCheckpointsTable {
  job_key: string;
  phase: string;
  cursor: Generated<Record<string, unknown>>;
  rows_processed: Generated<string>;
  status: Generated<"pending" | "running" | "complete" | "blocked">;
  last_error_code: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  updated_at: Generated<Date>;
}

export interface ConnectionEmailAlertsTable {
  notification_created_at: Date | null;
  id: Generated<string>;
  connection_id: string;
  user_id: string;
  kind: "disconnected" | "logged_out";
  occurred_at: Generated<Date>;
  next_attempt_at: Date;
  attempts: Generated<number>;
  sent_at: Date | null;
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
  /**
   * Set when whatsmeow reported terminal session loss, cleared on the next
   * connect. A logged-out connection is also `status = 'disconnected'`; this
   * marks the disconnect as unrecoverable, so nothing waits for a reconnect
   * that cannot come without a fresh QR scan.
   */
  logged_out_at: Date | null;
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
  username: Generated<string | null>;
  custom_name: string | null;
  notes_shared: string | null;
  is_group: Generated<boolean>;
  is_online: Generated<boolean>;
  last_seen: Date | null;
  is_blocked: Generated<boolean>;
  profile_picture_url: string | null;
  remote_history_status: Generated<RemoteHistoryStatus>;
  remote_history_updated_at: Date | null;
  display_name: string | null;
  organization_name: string | null;
  avatar_url: string | null;
  record_kind: "customer" | "legacy_group_projection" | null;
  merged_into_contact_id: string | null;
  archived_at: Date | null;
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
  conversation_id: string | null;
  assigned_to: string;
  assigned_by: string;
  assigned_at: Generated<Date>;
  unassigned_at: Date | null;
}

export interface ContactNotesPrivateTable {
  id: Generated<string>;
  contact_id: string;
  conversation_id: string | null;
  user_id: string;
  content: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ContactNotesSharedTable {
  id: Generated<string>;
  contact_id: string;
  conversation_id: string | null;
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
  /** Durable, explicit case membership - never inferred from `timestamp`. See migration 061. */
  case_id: string | null;
  /**
   * Strictly monotonic per-tenant ingestion sequence - the authoritative
   * turn-ordering key for episode start/response detection, never
   * `created_at`/`id`. Returned as a string by the pg driver (BIGINT).
   * NULL for every row inserted before migration 061 (the sequence
   * default was attached without backfilling existing rows to avoid a
   * full-table rewrite) - those rows also always have `case_id IS NULL`,
   * so they're already excluded from every `seq`-ordered query. See
   * migration 061.
   */
  seq: Generated<string | null>;
  channel_account_id: string | null;
  conversation_id: string | null;
  external_message_id: string | null;
  external_identity_scope: string | null;
  client_idempotency_key: string | null;
  direction: "inbound" | "outbound" | "system" | null;
  sender_participant_id: string | null;
  reply_to_message_id: string | null;
  provider_occurred_at: Date | null;
  normalized_type: string | null;
  subject: string | null;
  text_content: string | null;
  sanitized_html_content: string | null;
  provider_metadata: Record<string, unknown> | null;
}

export interface MessageReactionsTable {
  id: Generated<string>;
  message_id: string;
  reactor_jid: string;
  emoji: string;
  reactor_endpoint_id: string | null;
  channel_account_id: string | null;
  external_reaction_id: string | null;
  external_event_scope: string | null;
  provider_occurred_at: Date | null;
  provider_metadata: Record<string, unknown> | null;
  created_at: Generated<Date>;
}

/**
 * WhatsApp-authoritative group state.
 *
 * Every column below `participant_count` mirrors a value WhatsApp reported for
 * the group. Nothing here may be written speculatively from an API request -
 * see `apps/api/src/services/group-sync.service.ts`, which is the only writer.
 */
export interface GroupsTable {
  id: Generated<string>;
  contact_id: string | null;
  jid: string | null;
  name: string | null;
  description: string | null;
  created_by: string | null;
  created_at: Generated<Date>;
  participant_count: Generated<number>;
  /** JID of the group owner as reported by WhatsApp. */
  owner_jid: string | null;
  /** Only admins may send messages ("announcement" group). */
  is_announce: Generated<boolean>;
  /** Only admins may edit the group's name, icon and description. */
  is_locked: Generated<boolean>;
  /** Disappearing messages are enabled. */
  is_ephemeral: Generated<boolean>;
  /** Disappearing-message timer in seconds; 0 when disabled. */
  disappearing_timer: Generated<number>;
  /** New members must be approved by an admin before joining. */
  is_join_approval_required: Generated<boolean>;
  /** Who may add participants: `admin_add` or `all_member_add`. */
  member_add_mode: string | null;
  /** False once the connected account has left the group. */
  is_member: Generated<boolean>;
  /** Last invite link WhatsApp returned; only ever set from a worker result. */
  invite_link: string | null;
  invite_link_updated_at: Date | null;
  /** When WhatsApp last confirmed the metadata above. */
  metadata_synced_at: Date | null;
  /**
   * When the pending join requests were last read from WhatsApp.
   *
   * Kept on the group rather than derived from `group_join_requests`, because
   * "we asked and nobody is waiting" deletes every row - and would otherwise be
   * indistinguishable from "we never asked".
   */
  join_requests_synced_at: Date | null;
}

export interface GroupParticipantsTable {
  id: Generated<string>;
  group_id: string;
  participant_jid: string;
  is_admin: Generated<boolean>;
  joined_at: Generated<Date>;
}

/**
 * Pending "request to join" entries for groups with join approval enabled.
 *
 * WhatsApp only exposes these on demand, so rows are a cached projection of the
 * last worker fetch rather than a continuously-maintained list.
 */
export interface GroupJoinRequestsTable {
  id: Generated<string>;
  group_id: string;
  requester_jid: string;
  requested_at: Date | null;
  synced_at: Generated<Date>;
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

export interface AutoReplySettingsTable {
  id: Generated<number>;
  enabled: Generated<boolean>;
  quick_reply_id: string | null;
  delay_minutes: Generated<number>;
  send_mode: Generated<"always" | "outside_business_hours">;
  updated_by: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ConversationStatesTable {
  id: Generated<string>;
  contact_id: string;
  conversation_id: string | null;
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
  /** The contact's current open/pending conversation_cases row, or null when resolved. */
  active_case_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export type ConversationCaseKind = "direct" | "group";
export type ConversationCaseStatus = "open" | "pending" | "resolved";
export type ConversationCaseOpenSource = "live_inbound" | "manual";
export type ConversationCaseResolutionOutcome =
  | "handled"
  | "no_reply_needed"
  | "spam"
  | "duplicate"
  | "other";

/**
 * One immutable lifecycle cycle for a contact/group conversation. Both SLA
 * guarantees (response, resolution) are measured against a case's
 * boundaries; every reopen creates a new row rather than mutating this one.
 * See migration 061 for the full data-model rationale.
 */
export interface ConversationCasesTable {
  id: Generated<string>;
  contact_id: string;
  conversation_id: string | null;
  company_id: string | null;
  kind: ConversationCaseKind;
  status: Generated<ConversationCaseStatus>;
  opened_at: Date;
  opening_message_id: string | null;
  /** 'live_inbound' (opened_by null) or 'manual' (opened_by the acting user) - an immutable audit trail. */
  open_source: ConversationCaseOpenSource;
  opened_by: string | null;
  /** Snapshot of the public.sla_policies row active at opened_at - never re-resolved after opening. */
  policy_id: string;
  response_target_minutes: number;
  resolution_target_minutes: number;
  /** Set for BOTH automatic and manual reopens - not exclusive to manual ones. */
  reopened_from_case_id: string | null;
  reopen_reason: string | null;
  resolved_at: Date | null;
  resolved_by: string | null;
  resolution_outcome: ConversationCaseResolutionOutcome | null;
  resolution_notes: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ScheduledMessagesTable {
  id: Generated<string>;
  contact_id: string;
  conversation_id: string | null;
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
  /** Present only for an automatically queued first-contact reply. */
  auto_reply_trigger_message_id: string | null;
  auto_reply_quick_reply_id: string | null;
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
  purged_sent: Generated<number>;
  purged_failed: Generated<number>;
  purged_canceled: Generated<number>;
  purged_skipped: Generated<number>;
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

export type PurgeCleanupKind = "search_contact" | "media" | "bulk_job";

/** Durable post-commit work created by an irreversible connection purge. */
export interface PurgeCleanupItemsTable {
  id: Generated<string>;
  connection_id: string;
  kind: PurgeCleanupKind;
  reference: string;
  /** Canonical object key, set once a media item is committed for deletion. */
  media_key: string | null;
  attempts: Generated<number>;
  next_attempt_at: Generated<Date>;
  last_error: string | null;
  created_at: Generated<Date>;
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
export function createDatabase(
  connectionString: string,
  maxConnections: number = 10,
): Kysely<Database> {
  if (
    !Number.isSafeInteger(maxConnections) ||
    maxConnections <= 0 ||
    maxConnections > 50
  ) {
    throw new RangeError("Database pool maximum must be between 1 and 50");
  }
  const dialect = new PostgresDialect({
    pool: new Pool({
      connectionString,
      max: maxConnections,
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

function configuredPublicPoolMax(value: string | undefined): number {
  if (value === undefined || value === "") return 10;
  const parsed = Number(value);
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(parsed) ||
    parsed <= 0 ||
    parsed > 50
  ) {
    throw new Error("PUBLIC_DB_POOL_MAX must be an integer between 1 and 50");
  }
  return parsed;
}

// Default database instance using environment variables. This pool is per API
// replica, so production supplies a deliberately bounded value.
export const db = createDatabase(
  process.env.DATABASE_URL || "",
  configuredPublicPoolMax(process.env.PUBLIC_DB_POOL_MAX),
);
