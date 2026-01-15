/**
 * Mock tenant context utilities for testing
 *
 * These mocks simulate tenant database connections without actual PostgreSQL connections.
 */

import { mock } from "bun:test";
import { createMockDb } from "./database.mock";

/**
 * Store for mock tenant connections
 */
const mockTenantConnections = new Map<
  string,
  ReturnType<typeof createMockDb>
>();

/**
 * Gets or creates a mock tenant connection
 */
export function getMockTenantConnection(
  companyId: string,
  queryResults: Record<string, unknown> = {},
) {
  const existing = mockTenantConnections.get(companyId);
  if (existing) {
    return existing;
  }

  const mockDb = createMockDb(queryResults);
  mockTenantConnections.set(companyId, mockDb);
  return mockDb;
}

/**
 * Clears all mock tenant connections
 */
export function clearMockTenantConnections() {
  mockTenantConnections.clear();
}

/**
 * Creates a mock for the getTenantConnection function
 */
export function createMockGetTenantConnection(
  queryResults: Record<string, Record<string, unknown>> = {},
) {
  return mock((companyId: string) => {
    return getMockTenantConnection(companyId, queryResults[companyId] || {});
  });
}

/**
 * Creates a mock for the createTenantSchema function
 */
export function createMockCreateTenantSchema() {
  return mock(async (_companyId: string) => {
    // Simulates successful schema creation
    return Promise.resolve();
  });
}

/**
 * Creates a mock for the dropTenantSchema function
 */
export function createMockDropTenantSchema() {
  return mock(async (_companyId: string) => {
    // Simulates successful schema deletion
    return Promise.resolve();
  });
}

/**
 * Creates a mock for the tenantSchemaExists function
 */
export function createMockTenantSchemaExists(exists: boolean = true) {
  return mock(async (_companyId: string) => {
    return Promise.resolve(exists);
  });
}

/**
 * Creates a mock for the getSchemaName function
 */
export function createMockGetSchemaName() {
  return mock((companyId: string) => {
    return `tenant_${companyId.replace(/-/g, "_")}`;
  });
}

/**
 * Full mock tenant service module
 */
export function createMockTenantService(
  options: {
    schemaExists?: boolean;
    queryResults?: Record<string, Record<string, unknown>>;
  } = {},
) {
  const { schemaExists = true, queryResults = {} } = options;

  return {
    getTenantConnection: createMockGetTenantConnection(queryResults),
    createTenantSchema: createMockCreateTenantSchema(),
    dropTenantSchema: createMockDropTenantSchema(),
    tenantSchemaExists: createMockTenantSchemaExists(schemaExists),
    getSchemaName: createMockGetSchemaName(),
    clearTenantConnection: mock(async (_companyId: string) =>
      Promise.resolve(),
    ),
    clearAllTenantConnections: mock(async () => Promise.resolve()),
  };
}

/**
 * Test context helper - creates a full mock tenant context
 */
export interface MockTenantContext {
  companyId: string;
  userId: string;
  sessionId: string;
  tenantDb: ReturnType<typeof createMockDb>;
}

export function createMockTenantContext(
  overrides: Partial<MockTenantContext> = {},
): MockTenantContext {
  const companyId = overrides.companyId || "test-company-123";
  const tenantDb = overrides.tenantDb || createMockDb();

  return {
    companyId,
    userId: overrides.userId || "test-user-123",
    sessionId: overrides.sessionId || "test-session-123",
    tenantDb,
  };
}
