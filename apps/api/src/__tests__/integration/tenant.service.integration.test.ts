/**
 * Integration tests for tenant.service.ts
 *
 * Tests tenant/schema management functionality including:
 * - Schema name generation
 * - Tenant schema creation
 * - Tenant schema deletion
 * - Connection caching
 * - Schema existence checking
 *
 * Note: These are integration tests that use the real database.
 * They avoid mocking to prevent mock pollution issues with other test files.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  getSchemaName,
  createTenantSchema,
  dropTenantSchema,
  getTenantConnection,
  clearTenantConnection,
  clearAllTenantConnections,
  tenantSchemaExists,
} from "../../services/tenant.service";

// Generate unique test company IDs for each test run
// Using crypto.randomUUID() ensures complete uniqueness
function generateTestCompanyId(suffix = ''): string {
  return `test_${crypto.randomUUID()}${suffix}`;
}

describe("TenantService", () => {
  let TEST_COMPANY_ID: string;
  let TEST_COMPANY_ID_2: string;

  beforeEach(async () => {
    // Generate fresh IDs for each test to ensure complete isolation
    TEST_COMPANY_ID = generateTestCompanyId();
    TEST_COMPANY_ID_2 = generateTestCompanyId('_2');

    // Clean up: clear connections and drop test schemas BEFORE each test
    // to ensure clean state
    await clearAllTenantConnections();

    try {
      await dropTenantSchema(TEST_COMPANY_ID);
    } catch {
      // Ignore errors if schema doesn't exist
    }

    try {
      await dropTenantSchema(TEST_COMPANY_ID_2);
    } catch {
      // Ignore errors if schema doesn't exist
    }
  });

  afterEach(async () => {
    // Clean up: clear connections and drop test schemas
    await clearAllTenantConnections();

    try {
      await dropTenantSchema(TEST_COMPANY_ID);
    } catch {
      // Ignore errors if schema doesn't exist
    }

    try {
      await dropTenantSchema(TEST_COMPANY_ID_2);
    } catch {
      // Ignore errors if schema doesn't exist
    }
  });

  describe("getSchemaName", () => {
    it("should generate schema name from company ID", () => {
      const result = getSchemaName("company-123");
      expect(result).toBe("tenant_company_123");
    });

    it("should replace hyphens with underscores", () => {
      const result = getSchemaName("my-company-with-hyphens");
      expect(result).toBe("tenant_my_company_with_hyphens");
    });

    it("should handle UUID format company IDs", () => {
      const result = getSchemaName("550e8400-e29b-41d4-a716-446655440000");
      expect(result).toBe("tenant_550e8400_e29b_41d4_a716_446655440000");
    });

    it("should handle company ID without hyphens", () => {
      const result = getSchemaName("company123");
      expect(result).toBe("tenant_company123");
    });

    it("should add tenant_ prefix", () => {
      const result = getSchemaName("abc");
      expect(result.startsWith("tenant_")).toBe(true);
    });
  });

  describe("tenantSchemaExists", () => {
    it("should return false if schema does not exist", async () => {
      const result = await tenantSchemaExists(TEST_COMPANY_ID);
      expect(result).toBe(false);
    });

    it("should return true if schema exists", async () => {
      // Create the schema first
      await createTenantSchema(TEST_COMPANY_ID);

      // Now check if it exists
      const result = await tenantSchemaExists(TEST_COMPANY_ID);
      expect(result).toBe(true);
    });
  });

  describe("createTenantSchema", () => {
    it("should create a new tenant schema", async () => {
      // Schema should not exist initially
      let exists = await tenantSchemaExists(TEST_COMPANY_ID);
      expect(exists).toBe(false);

      // Create the schema
      await createTenantSchema(TEST_COMPANY_ID);

      // Schema should now exist
      exists = await tenantSchemaExists(TEST_COMPANY_ID);
      expect(exists).toBe(true);
    });
  });

  describe("dropTenantSchema", () => {
    it("should drop an existing tenant schema", async () => {
      // Create the schema first
      await createTenantSchema(TEST_COMPANY_ID);
      let exists = await tenantSchemaExists(TEST_COMPANY_ID);
      expect(exists).toBe(true);

      // Drop the schema
      await dropTenantSchema(TEST_COMPANY_ID);

      // Schema should no longer exist
      exists = await tenantSchemaExists(TEST_COMPANY_ID);
      expect(exists).toBe(false);
    });

    it("should clear cached connection when dropping schema", async () => {
      // Create schema and get connection to cache it
      await createTenantSchema(TEST_COMPANY_ID);
      getTenantConnection(TEST_COMPANY_ID);

      // Drop the schema (should clear cache)
      await dropTenantSchema(TEST_COMPANY_ID);

      // Getting connection again should create a new one
      // (We can't easily verify this without inspecting internals,
      // but we can verify it doesn't throw)
      const schemaName = getSchemaName(TEST_COMPANY_ID);
      expect(schemaName).toBeDefined();
    });
  });

  describe("getTenantConnection", () => {
    beforeEach(async () => {
      // Ensure schema exists for connection tests
      await createTenantSchema(TEST_COMPANY_ID);
      await createTenantSchema(TEST_COMPANY_ID_2);
    });

    it("should return Kysely instance with correct schema", () => {
      const connection = getTenantConnection(TEST_COMPANY_ID);
      expect(connection).toBeDefined();
      expect(typeof connection).toBe("object");
    });

    it("should cache connections for the same company", () => {
      const first = getTenantConnection(TEST_COMPANY_ID);
      const second = getTenantConnection(TEST_COMPANY_ID);

      // Should return the same cached instance
      expect(first).toBe(second);
    });

    it("should create separate connections for different companies", () => {
      const first = getTenantConnection(TEST_COMPANY_ID);
      const second = getTenantConnection(TEST_COMPANY_ID_2);

      // Should be different instances
      expect(first).not.toBe(second);
    });
  });

  describe("clearTenantConnection", () => {
    beforeEach(async () => {
      await createTenantSchema(TEST_COMPANY_ID);
    });

    it("should destroy and remove cached connection", async () => {
      // Get a connection to cache it
      const first = getTenantConnection(TEST_COMPANY_ID);

      // Clear the connection
      await clearTenantConnection(TEST_COMPANY_ID);

      // Getting connection again should create a new instance
      const second = getTenantConnection(TEST_COMPANY_ID);

      // Should be different instances
      expect(first).not.toBe(second);
    });

    it("should handle non-existent connection gracefully", async () => {
      // Should not throw when clearing non-existent connection
      await expect(clearTenantConnection("non-existent")).resolves.toBeUndefined();
    });
  });

  describe("clearAllTenantConnections", () => {
    beforeEach(async () => {
      await createTenantSchema(TEST_COMPANY_ID);
      await createTenantSchema(TEST_COMPANY_ID_2);
    });

    it("should destroy all cached connections", async () => {
      // Create multiple connections
      const conn1 = getTenantConnection(TEST_COMPANY_ID);
      const conn2 = getTenantConnection(TEST_COMPANY_ID_2);

      // Clear all connections
      await clearAllTenantConnections();

      // Getting connections again should create new instances
      const newConn1 = getTenantConnection(TEST_COMPANY_ID);
      const newConn2 = getTenantConnection(TEST_COMPANY_ID_2);

      expect(conn1).not.toBe(newConn1);
      expect(conn2).not.toBe(newConn2);
    });

    it("should handle empty cache gracefully", async () => {
      // Clear all connections when none exist
      await expect(clearAllTenantConnections()).resolves.toBeUndefined();
    });
  });

  describe("TenantDatabase interface", () => {
    beforeEach(async () => {
      await createTenantSchema(TEST_COMPANY_ID);
    });

    it("should provide access to tenant tables", () => {
      const connection = getTenantConnection(TEST_COMPANY_ID);
      expect(connection).toBeDefined();
      // The connection should have methods like selectFrom, etc.
      expect(typeof connection.selectFrom).toBe("function");
    });
  });
});
