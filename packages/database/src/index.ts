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
export {
  dropLegacyLabelUniqueIndex,
  formatDuplicateBlockers,
  formatPreflightReport,
  preflightTenantIndexNames,
  legacyIdentifier,
  PG_IDENTIFIER_MAX_BYTES,
  reconcileTenantIndexNames,
  renameTenantRelation,
  targetIdentifier,
  TENANT_INDEX_TARGETS,
  TENANT_SCHEMA_NAME_LENGTH,
  TENANT_SUFFIX_BUDGET,
} from "./tenant-index-names";
export type {
  DuplicateBlocker,
  TenantIndexPreflightRow,
  TenantIndexReconcileResult,
  TenantIndexTarget,
} from "./tenant-index-names";

// Re-export types from shared package for convenience
export type {
  CompanyStatus,
  CompanyMemberRole,
  MessageType,
  MessageStatus,
  ScheduledMessageStatus,
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
  SlaPoliciesTable,
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
  ConversationCasesTable,
  ConversationCaseKind,
  ConversationCaseStatus,
  ConversationCaseOpenSource,
  ConversationCaseResolutionOutcome,
  ScheduledMessagesTable,
  BulkJobsTable,
  BulkConnectionBudgetsTable,
  WhatsAppLabelsTable,
  WhatsAppCatalogsTable,
  CatalogProductsTable,
  WhatsAppConnectionStatus,
  NotificationType,
  ConversationStatus,
  CatalogStatus,
  ProductVisibility,
} from "./client";
