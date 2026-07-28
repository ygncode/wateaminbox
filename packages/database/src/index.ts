export {
  db,
  createDatabase,
  createTenantDatabase,
  getTenantSchemaName,
} from "./client";
export {
  reconcileTenantSchema,
  TENANT_SCHEMA_CONTRACT,
} from "./tenant-schema";
export type { TenantSchemaContractIsComplete } from "./tenant-schema";

// Re-export types from shared package for convenience
export type {
  CompanyStatus,
  CompanyMemberRole,
  MessageType,
  MessageStatus,
} from "@wateaminbox/shared";

export type {
  Database,
  TenantDatabase,
  // Public schema types
  CompaniesTable,
  UsersTable,
  CompanyMembersTable,
  InvitationsTable,
  CompanyStatsTable,
  UserSessionsTable,
  AuthTokensTable,
  AuthTokenType,
  /** @deprecated Use CompanyMemberRole from @wateaminbox/shared instead */
  MemberRole,
  // Tenant schema types
  WhatsAppConnectionsTable,
  ContactsTable,
  TagsTable,
  ContactTagsTable,
  ContactAssignmentsTable,
  ContactNotesPrivateTable,
  ContactNotesSharedTable,
  TenantMessagesTable,
  MessageReactionsTable,
  GroupsTable,
  GroupParticipantsTable,
  StatusUpdatesTable,
  AuditLogsTable,
  NotificationPreferencesTable,
  NotificationHistoryTable,
  QuickRepliesTable,
  ConversationStatesTable,
  WhatsAppLabelsTable,
  WhatsAppCatalogsTable,
  CatalogProductsTable,
  WhatsAppConnectionStatus,
  NotificationType,
  ConversationStatus,
  CatalogStatus,
  ProductVisibility,
} from "./client";
