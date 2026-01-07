/**
 * Mock database utilities for testing services
 *
 * These mocks simulate Kysely database operations without actual database connections.
 *
 * Usage patterns:
 * 1. Simple mocking: Use createMockQueryBuilder(returnValue) for basic query mocking
 * 2. Mutable pattern: Use createMutableMockQueryBuilder() with resetMockQueryBuilder() for tests
 *    that need to change return values between test cases
 * 3. Full DB mock: Use createMockDb(queryResults) for complete database instance mocking
 */

import { mock } from "bun:test";

/**
 * All Kysely chainable methods supported by the mock
 */
const CHAIN_METHODS = [
  "selectFrom",
  "insertInto",
  "updateTable",
  "deleteFrom",
  "select",
  "selectAll",
  "where",
  "values",
  "set",
  "returning",
  "returningAll",
  "innerJoin",
  "leftJoin",
  "rightJoin",
  "fullJoin",
  "on",
  "onRef",
  "orderBy",
  "limit",
  "offset",
  "groupBy",
  "having",
  "$if",
  "$call",
  "filterWhere",
  "distinctOn",
  "distinct",
] as const;

/**
 * Creates a mock query builder that chains method calls
 */
export function createMockQueryBuilder(returnValue: unknown = undefined) {
  const mockBuilder: Record<string, unknown> = {};

  const terminalMethods = {
    execute: mock(() => Promise.resolve(Array.isArray(returnValue) ? returnValue : [])),
    executeTakeFirst: mock(() => Promise.resolve(returnValue)),
    executeTakeFirstOrThrow: mock(() => {
      if (returnValue === undefined) {
        throw new Error("no result");
      }
      return Promise.resolve(returnValue);
    }),
  };

  // Setup chainable methods
  CHAIN_METHODS.forEach((method) => {
    mockBuilder[method] = mock(() => mockBuilder);
  });

  // Setup terminal methods
  Object.entries(terminalMethods).forEach(([method, fn]) => {
    mockBuilder[method] = fn;
  });

  // Additional methods used by some tests
  mockBuilder.as = mock(() => mockBuilder);
  mockBuilder.or = mock(() => true);
  mockBuilder.fn = {
    max: mock(() => mockBuilder),
    count: mock(() => mockBuilder),
    sum: mock(() => mockBuilder),
    avg: mock(() => mockBuilder),
    min: mock(() => mockBuilder),
  };

  return mockBuilder;
}

/**
 * Creates a mutable mock query builder for tests that need to change return values.
 *
 * Usage:
 *   let mockQueryBuilder: ReturnType<typeof createMutableMockQueryBuilder>;
 *   beforeEach(() => { mockQueryBuilder = createMutableMockQueryBuilder(); });
 *
 *   it('test case', () => {
 *     resetMockQueryBuilder(mockQueryBuilder, { id: '123' });
 *     // ... test code
 *   });
 */
export function createMutableMockQueryBuilder() {
  return createMockQueryBuilder(undefined);
}

/**
 * Resets a mutable mock query builder with a new return value.
 * Recreates all mock functions to ensure clean state between tests.
 */
export function resetMockQueryBuilder(
  mockBuilder: Record<string, unknown>,
  returnValue: unknown = undefined
) {
  // Reset chainable methods
  CHAIN_METHODS.forEach((method) => {
    mockBuilder[method] = mock(() => mockBuilder);
  });

  // Reset terminal methods with new return value
  mockBuilder.execute = mock(() =>
    Promise.resolve(Array.isArray(returnValue) ? returnValue : [])
  );
  mockBuilder.executeTakeFirst = mock(() => Promise.resolve(returnValue));
  mockBuilder.executeTakeFirstOrThrow = mock(() => {
    if (returnValue === undefined) {
      throw new Error("no result");
    }
    return Promise.resolve(returnValue);
  });

  // Reset additional methods
  mockBuilder.as = mock(() => mockBuilder);
  mockBuilder.or = mock(() => true);
  mockBuilder.fn = {
    max: mock(() => mockBuilder),
    count: mock(() => mockBuilder),
    sum: mock(() => mockBuilder),
    avg: mock(() => mockBuilder),
    min: mock(() => mockBuilder),
  };

  return mockBuilder;
}

/**
 * Creates a mock database instance
 */
export function createMockDb(queryResults: Record<string, unknown> = {}) {
  const defaultResult = undefined;

  return {
    selectFrom: mock((table: string) => createMockQueryBuilder(queryResults[table] ?? defaultResult)),
    insertInto: mock((table: string) => createMockQueryBuilder(queryResults[`insert_${table}`] ?? defaultResult)),
    updateTable: mock((table: string) => createMockQueryBuilder(queryResults[`update_${table}`] ?? defaultResult)),
    deleteFrom: mock((table: string) => createMockQueryBuilder(queryResults[`delete_${table}`] ?? defaultResult)),
    transaction: mock(() => ({
      execute: mock((callback: (trx: unknown) => Promise<unknown>) => {
        const trxDb = createMockDb(queryResults);
        return callback(trxDb);
      }),
    })),
    withSchema: mock(() => createMockDb(queryResults)),
    destroy: mock(() => Promise.resolve()),
  };
}

/**
 * Creates a mock result with numUpdatedRows property
 */
export function createUpdateResult(numUpdatedRows: number | bigint) {
  return { numUpdatedRows: BigInt(numUpdatedRows) };
}

/**
 * Creates a mock result with numDeletedRows property
 */
export function createDeleteResult(numDeletedRows: number | bigint) {
  return { numDeletedRows: BigInt(numDeletedRows) };
}

/**
 * Helper to create mock user data
 */
export function createMockUser(overrides: Partial<MockUser> = {}): MockUser {
  return {
    id: "user-123",
    email: "test@example.com",
    password_hash: "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.VTtYVX7.lB2mKu", // "Password123"
    email_verified_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

/**
 * Helper to create mock session data
 */
export function createMockSession(overrides: Partial<MockSession> = {}): MockSession {
  return {
    id: "session-123",
    user_id: "user-123",
    device_name: "Chrome on MacOS",
    device_type: "desktop",
    ip_address: "127.0.0.1",
    user_agent: "Mozilla/5.0",
    refresh_token: "refresh-token-abc",
    last_active_at: new Date(),
    created_at: new Date(),
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    ...overrides,
  };
}

/**
 * Helper to create mock company data
 */
export function createMockCompany(overrides: Partial<MockCompany> = {}): MockCompany {
  return {
    id: "company-123",
    name: "Test Company",
    schema_name: "tenant_company_123",
    status: "active" as const,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

/**
 * Helper to create mock company member data
 */
export function createMockCompanyMember(overrides: Partial<MockCompanyMember> = {}): MockCompanyMember {
  return {
    id: "member-123",
    user_id: "user-123",
    company_id: "company-123",
    role: "member" as const,
    permissions: {},
    invited_by: null,
    joined_at: new Date(),
    ...overrides,
  };
}

/**
 * Helper to create mock invitation data
 */
export function createMockInvitation(overrides: Partial<MockInvitation> = {}): MockInvitation {
  return {
    id: "invitation-123",
    company_id: "company-123",
    email: "invited@example.com",
    token: "invite-token-abc",
    invited_by: "user-123",
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    accepted_at: null,
    created_at: new Date(),
    ...overrides,
  };
}

/**
 * Helper to create mock audit log data
 */
export function createMockAuditLog(overrides: Partial<MockAuditLog> = {}): MockAuditLog {
  return {
    id: "audit-123",
    user_id: "user-123",
    action: "user.login",
    entity_type: null,
    entity_id: null,
    details: null,
    ip_address: "127.0.0.1",
    created_at: new Date(),
    ...overrides,
  };
}

/**
 * Helper to create mock WhatsApp connection data
 */
export function createMockWhatsAppConnection(overrides: Partial<MockWhatsAppConnection> = {}): MockWhatsAppConnection {
  return {
    id: "connection-123",
    phone_number: "+1234567890",
    jid: "1234567890@s.whatsapp.net",
    status: "connected" as const,
    connected_by: "user-123",
    connected_at: new Date(),
    last_sync_at: new Date(),
    session_data: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

/**
 * Helper to create mock contact data
 */
export function createMockContact(overrides: Partial<MockContact> = {}): MockContact {
  return {
    id: "contact-123",
    whatsapp_connection_id: "connection-123",
    jid: "9876543210@s.whatsapp.net",
    phone_number: "+9876543210",
    push_name: "John Doe",
    custom_name: null,
    notes_shared: null,
    is_group: false,
    profile_picture_url: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

/**
 * Helper to create mock message data
 */
export function createMockMessage(overrides: Partial<MockMessage> = {}): MockMessage {
  return {
    id: "message-123",
    whatsapp_connection_id: "connection-123",
    contact_id: "contact-123",
    message_id: "wa-msg-123",
    from_me: false,
    sender_jid: "9876543210@s.whatsapp.net",
    message_type: "text" as const,
    content: "Hello, world!",
    media_url: null,
    media_mime_type: null,
    media_size: null,
    quoted_message_id: null,
    is_forwarded: false,
    is_starred: false,
    deleted_by_sender: false,
    deleted_at: null,
    sent_by_user_id: null,
    status: "sent" as const,
    metadata: null,
    timestamp: new Date(),
    created_at: new Date(),
    search_vector: null,
    ...overrides,
  };
}

// Type definitions for mock data
export interface MockUser {
  id: string;
  email: string;
  password_hash: string;
  email_verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface MockSession {
  id: string;
  user_id: string;
  device_name: string | null;
  device_type: string | null;
  ip_address: string | null;
  user_agent: string | null;
  refresh_token: string;
  last_active_at: Date;
  created_at: Date;
  expires_at: Date;
}

export interface MockCompany {
  id: string;
  name: string;
  schema_name: string;
  status: "active" | "suspended" | "deleted";
  created_at: Date;
  updated_at: Date;
}

export interface MockCompanyMember {
  id: string;
  user_id: string;
  company_id: string;
  role: "owner" | "admin" | "member";
  permissions: Record<string, unknown>;
  invited_by: string | null;
  joined_at: Date;
}

export interface MockInvitation {
  id: string;
  company_id: string;
  email: string;
  token: string;
  invited_by: string;
  expires_at: Date;
  accepted_at: Date | null;
  created_at: Date;
}

export interface MockAuditLog {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: Date;
}

export interface MockWhatsAppConnection {
  id: string;
  phone_number: string | null;
  jid: string | null;
  status: "connected" | "disconnected" | "banned" | "pending";
  connected_by: string | null;
  connected_at: Date | null;
  last_sync_at: Date | null;
  session_data: Buffer | null;
  created_at: Date;
  updated_at: Date;
}

export interface MockContact {
  id: string;
  whatsapp_connection_id: string | null;
  jid: string | null;
  phone_number: string | null;
  push_name: string | null;
  custom_name: string | null;
  notes_shared: string | null;
  is_group: boolean;
  profile_picture_url: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface MockMessage {
  id: string;
  whatsapp_connection_id: string | null;
  contact_id: string | null;
  message_id: string | null;
  from_me: boolean;
  sender_jid: string | null;
  message_type: "text" | "image" | "video" | "audio" | "document" | "sticker" | "location" | "contact" | "reaction";
  content: string | null;
  media_url: string | null;
  media_mime_type: string | null;
  media_size: number | null;
  quoted_message_id: string | null;
  is_forwarded: boolean;
  is_starred: boolean;
  deleted_by_sender: boolean;
  deleted_at: Date | null;
  sent_by_user_id: string | null;
  status: "pending" | "sent" | "delivered" | "read" | "failed";
  metadata: Record<string, unknown> | null;
  timestamp: Date;
  created_at: Date;
  search_vector: unknown | null;
}

export interface MockNotificationPreferences {
  id: string;
  user_id: string;
  sound_enabled: boolean;
  sound_choice: string;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  muted_contacts: string[] | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Helper to create mock notification preferences data
 */
export function createMockNotificationPreferences(overrides: Partial<MockNotificationPreferences> = {}): MockNotificationPreferences {
  return {
    id: "notification-pref-123",
    user_id: "user-123",
    sound_enabled: true,
    sound_choice: "default",
    quiet_hours_start: null,
    quiet_hours_end: null,
    muted_contacts: [],
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

export interface MockNotificationHistory {
  id: string;
  user_id: string;
  notification_type: "message" | "mention" | "assignment" | "team" | "system";
  title: string;
  message: string | null;
  action_url: string | null;
  metadata: Record<string, unknown> | null;
  is_read: boolean;
  read_at: Date | null;
  created_at: Date;
}

/**
 * Helper to create mock notification history data
 */
export function createMockNotificationHistory(overrides: Partial<MockNotificationHistory> = {}): MockNotificationHistory {
  return {
    id: "notification-123",
    user_id: "user-123",
    notification_type: "message" as const,
    title: "New message from John",
    message: "Hello, how are you?",
    action_url: "/chat/contact-123",
    metadata: null,
    is_read: false,
    read_at: null,
    created_at: new Date(),
    ...overrides,
  };
}

export interface MockQuickReply {
  id: string;
  shortcut: string;
  title: string;
  content: string;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Helper to create mock quick reply data
 */
export function createMockQuickReply(overrides: Partial<MockQuickReply> = {}): MockQuickReply {
  return {
    id: "quick-reply-123",
    shortcut: "greeting",
    title: "Greeting Message",
    content: "Hello! Thank you for contacting us. How can I help you today?",
    created_by: "user-123",
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

export interface MockStatusUpdate {
  id: string;
  whatsapp_connection_id: string | null;
  status_id: string | null;
  from_jid: string | null;
  media_type: string | null;
  media_url: string | null;
  caption: string | null;
  timestamp: Date;
  expires_at: Date;
}

/**
 * Helper to create mock status update data
 */
export function createMockStatusUpdate(overrides: Partial<MockStatusUpdate> = {}): MockStatusUpdate {
  const now = new Date();
  return {
    id: "status-123",
    whatsapp_connection_id: "connection-123",
    status_id: "wa-status-123",
    from_jid: "1234567890@s.whatsapp.net",
    media_type: null,
    media_url: null,
    caption: "Hello from my status!",
    timestamp: now,
    expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000), // 24 hours from now
    ...overrides,
  };
}

export interface MockConversationState {
  id: string;
  contact_id: string;
  status: "open" | "pending" | "resolved";
  resolved_at: Date | null;
  resolved_by: string | null;
  reopened_at: Date | null;
  reopened_by: string | null;
  resolution_notes: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Helper to create mock conversation state data
 */
export function createMockConversationState(overrides: Partial<MockConversationState> = {}): MockConversationState {
  return {
    id: "conv-state-123",
    contact_id: "contact-123",
    status: "open" as const,
    resolved_at: null,
    resolved_by: null,
    reopened_at: null,
    reopened_by: null,
    resolution_notes: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

export interface MockWhatsAppLabel {
  id: string;
  label_id: string;
  name: string;
  color: string | null;
  predefined_id: number | null;
  synced_tag_id: string | null;
  last_synced_at: Date;
  created_at: Date;
  updated_at: Date;
}

/**
 * Helper to create mock WhatsApp label data
 */
export function createMockWhatsAppLabel(overrides: Partial<MockWhatsAppLabel> = {}): MockWhatsAppLabel {
  const now = new Date();
  return {
    id: "wa-label-123",
    label_id: "label-123",
    name: "Important",
    color: "#ef4444",
    predefined_id: 7,
    synced_tag_id: null,
    last_synced_at: now,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

export interface MockTag {
  id: string;
  name: string;
  color: string | null;
  whatsapp_label_id: string | null;
  synced_at: Date | null;
  created_by: string | null;
  created_at: Date;
}

/**
 * Helper to create mock tag data
 */
export function createMockTag(overrides: Partial<MockTag> = {}): MockTag {
  return {
    id: "tag-123",
    name: "VIP",
    color: "#3b82f6",
    whatsapp_label_id: null,
    synced_at: null,
    created_by: "user-123",
    created_at: new Date(),
    ...overrides,
  };
}
