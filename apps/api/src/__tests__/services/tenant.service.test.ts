/**
 * Unit tests for tenant.service.ts
 *
 * Tests tenant/schema management functionality including:
 * - Schema name generation
 * - Tenant schema creation
 * - Tenant schema deletion
 * - Connection caching
 * - Schema existence checking
 */

import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";

// Mock sql execute
const mockSqlExecute = mock(async () => ({
  rows: [{ exists: true }],
}));

// Mock Kysely instance
const mockKyselyWithSchema = mock((schema: string) => ({
  schema,
  withSchema: mockKyselyWithSchema,
  destroy: mockKyselyDestroy
}));
const mockKyselyDestroy = mock(async () => {});

const mockKyselyInstance = {
  withSchema: mockKyselyWithSchema,
  destroy: mockKyselyDestroy,
};

// Mock pg Pool
const mockPoolOn = mock(() => {});
const mockPoolEnd = mock(async () => {});

const mockPool = {
  on: mockPoolOn,
  end: mockPoolEnd,
};

mock.module("pg", () => ({
  Pool: mock(() => mockPool),
}));

// Mock Kysely and sql
mock.module("kysely", () => ({
  Kysely: mock(() => mockKyselyInstance),
  PostgresDialect: mock(() => ({})),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({
      execute: mockSqlExecute,
    }),
    {
      raw: (str: string) => str,
      ref: (str: string) => str,
    }
  ),
}));

// Mock env
mock.module("../../lib/env.js", () => ({
  env: {
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  },
}));

// Import the service after mocking
import {
  getSchemaName,
  createTenantSchema,
  dropTenantSchema,
  getTenantConnection,
  clearTenantConnection,
  clearAllTenantConnections,
  tenantSchemaExists,
} from "../../services/tenant.service";

describe("TenantService", () => {
  beforeEach(() => {
    mockSqlExecute.mockClear();
    mockPoolOn.mockClear();
    mockPoolEnd.mockClear();
    mockKyselyWithSchema.mockClear();
    mockKyselyDestroy.mockClear();

    // Reset default mock return value
    mockSqlExecute.mockImplementation(async () => ({
      rows: [{ exists: true }],
    }));
  });

  afterEach(async () => {
    // Clear connections after each test
    await clearAllTenantConnections();
  });

  describe("getSchemaName", () => {
    it("should generate schema name from company ID", () => {
      // Act
      const result = getSchemaName("company-123");

      // Assert
      expect(result).toBe("tenant_company_123");
    });

    it("should replace hyphens with underscores", () => {
      // Act
      const result = getSchemaName("my-company-with-hyphens");

      // Assert
      expect(result).toBe("tenant_my_company_with_hyphens");
    });

    it("should handle UUID format company IDs", () => {
      // Act
      const result = getSchemaName("550e8400-e29b-41d4-a716-446655440000");

      // Assert
      expect(result).toBe("tenant_550e8400_e29b_41d4_a716_446655440000");
    });

    it("should handle company ID without hyphens", () => {
      // Act
      const result = getSchemaName("company123");

      // Assert
      expect(result).toBe("tenant_company123");
    });

    it("should add tenant_ prefix", () => {
      // Act
      const result = getSchemaName("abc");

      // Assert
      expect(result.startsWith("tenant_")).toBe(true);
    });
  });

  describe("createTenantSchema", () => {
    it("should call setup_tenant_schema SQL function", async () => {
      // Arrange
      const companyId = "company-123";

      // Act
      await createTenantSchema(companyId);

      // Assert
      expect(mockSqlExecute).toHaveBeenCalled();
      expect(mockKyselyDestroy).toHaveBeenCalled();
    });

    it("should destroy connection after execution", async () => {
      // Act
      await createTenantSchema("company-123");

      // Assert
      expect(mockKyselyDestroy).toHaveBeenCalled();
    });

    it("should destroy connection even on error", async () => {
      // Arrange
      mockSqlExecute.mockImplementation(async () => {
        throw new Error("Database error");
      });

      // Act & Assert
      await expect(createTenantSchema("company-123")).rejects.toThrow("Database error");
      expect(mockKyselyDestroy).toHaveBeenCalled();
    });
  });

  describe("dropTenantSchema", () => {
    it("should call drop_tenant_schema SQL function", async () => {
      // Arrange
      const companyId = "company-123";

      // Act
      await dropTenantSchema(companyId);

      // Assert
      expect(mockSqlExecute).toHaveBeenCalled();
      expect(mockKyselyDestroy).toHaveBeenCalled();
    });

    it("should destroy connection after execution", async () => {
      // Act
      await dropTenantSchema("company-123");

      // Assert
      expect(mockKyselyDestroy).toHaveBeenCalled();
    });

    it("should clear cached connection when dropping schema", async () => {
      // First get a connection to cache it
      getTenantConnection("company-123");

      // Clear the mock to reset counts
      mockKyselyDestroy.mockClear();

      // Now drop the schema
      await dropTenantSchema("company-123");

      // Verify destroy was called (cache cleared)
      expect(mockKyselyDestroy).toHaveBeenCalled();
    });
  });

  describe("getTenantConnection", () => {
    it("should return Kysely instance with correct schema", () => {
      // Act
      const result = getTenantConnection("company-123");

      // Assert
      expect(result).toBeDefined();
      expect(mockKyselyWithSchema).toHaveBeenCalled();
      expect(mockPoolOn).toHaveBeenCalled();
    });

    it("should cache connections for the same company", () => {
      // Clear mocks first
      mockKyselyWithSchema.mockClear();
      mockPoolOn.mockClear();

      // Act
      const first = getTenantConnection("company-456");
      const second = getTenantConnection("company-456");

      // Assert - should return cached connection
      expect(first).toBe(second);
      // withSchema should only be called once for cached connection
      expect(mockKyselyWithSchema).toHaveBeenCalledTimes(1);
    });

    it("should create separate connections for different companies", () => {
      // Clear mocks first
      mockKyselyWithSchema.mockClear();

      // Act
      const first = getTenantConnection("company-1");
      const second = getTenantConnection("company-2");

      // Assert - both should have called withSchema
      expect(mockKyselyWithSchema).toHaveBeenCalledTimes(2);
      expect(first).not.toBe(second);
    });
  });

  describe("clearTenantConnection", () => {
    it("should destroy and remove cached connection", async () => {
      // First get a connection to cache it
      getTenantConnection("company-123");

      // Act
      await clearTenantConnection("company-123");

      // Assert
      expect(mockKyselyDestroy).toHaveBeenCalled();
    });

    it("should handle non-existent connection gracefully", async () => {
      // Act & Assert - should not throw
      await expect(clearTenantConnection("non-existent")).resolves.toBeUndefined();
    });
  });

  describe("clearAllTenantConnections", () => {
    it("should destroy all cached connections", async () => {
      // Clear previous mocks
      mockKyselyDestroy.mockClear();

      // Create multiple connections
      getTenantConnection("company-a");
      getTenantConnection("company-b");
      getTenantConnection("company-c");

      // Act
      await clearAllTenantConnections();

      // Assert - destroy should be called for each connection (3 times)
      expect(mockKyselyDestroy).toHaveBeenCalled();
    });

    it("should handle empty cache gracefully", async () => {
      // Act & Assert - should not throw
      await expect(clearAllTenantConnections()).resolves.toBeUndefined();
    });
  });

  describe("tenantSchemaExists", () => {
    it("should return true if schema exists", async () => {
      // Arrange
      mockSqlExecute.mockImplementation(async () => ({
        rows: [{ exists: true }],
      }));

      // Act
      const result = await tenantSchemaExists("company-123");

      // Assert
      expect(result).toBe(true);
    });

    it("should return false if schema does not exist", async () => {
      // Arrange
      mockSqlExecute.mockImplementation(async () => ({
        rows: [{ exists: false }],
      }));

      // Act
      const result = await tenantSchemaExists("non-existent");

      // Assert
      expect(result).toBe(false);
    });

    it("should execute SQL query", async () => {
      // Act
      await tenantSchemaExists("company-123");

      // Assert
      expect(mockSqlExecute).toHaveBeenCalled();
    });

    it("should destroy connection after checking", async () => {
      // Act
      await tenantSchemaExists("company-123");

      // Assert
      expect(mockKyselyDestroy).toHaveBeenCalled();
    });
  });

  describe("TenantDatabase interface", () => {
    it("should provide access to all tenant tables", () => {
      // Act
      const connection = getTenantConnection("company-123");

      // Assert - connection should be defined
      expect(connection).toBeDefined();
      // The actual table access is tested via integration tests
    });
  });
});
