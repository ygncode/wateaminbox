export { db, createDatabase, createTenantDatabase, getTenantSchemaName } from "./client";

// Re-export types from shared package for convenience
export type { CompanyStatus, CompanyMemberRole, MessageType, MessageStatus } from "@wateaminbox/shared";

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
