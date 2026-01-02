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

// Mock pg Pool
const mockPoolQuery = mock(async (_query: string, _params?: unknown[]) => ({
  rows: [{ schema_name: "test_schema" }],
}));

const mockPoolConnect = mock(async () => ({
  query: mockPoolQuery,
  release: mock(() => {}),
}));

const mockPoolEnd = mock(async () => {});

const mockPool = {
  connect: mockPoolConnect,
  end: mockPoolEnd,
};

mock.module("pg", () => ({
  Pool: mock(() => mockPool),
}));

// Mock Kysely
const mockKyselyWithSchema = mock(() => mockKyselyInstance);
const mockKyselyDestroy = mock(async () => {});

const mockKyselyInstance = {
  withSchema: mockKyselyWithSchema,
  destroy: mockKyselyDestroy,
};

mock.module("kysely", () => ({
  Kysely: mock(() => mockKyselyInstance),
  PostgresDialect: mock(() => ({})),
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
    mockPoolQuery.mockClear();
    mockPoolConnect.mockClear();
    mockPoolEnd.mockClear();
    mockKyselyWithSchema.mockClear();
    mockKyselyDestroy.mockClear();
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
      const expectedSchemaName = "tenant_company_123";

      // Act
      await createTenantSchema(companyId);

      // Assert
      expect(mockPoolConnect).toHaveBeenCalled();
      expect(mockPoolQuery).toHaveBeenCalledWith(
        "SELECT setup_tenant_schema($1)",
        [expectedSchemaName]
      );
    });

    it("should release connection after execution", async () => {
      // Arrange
      const mockRelease = mock(() => {});
      mockPoolConnect.mockImplementation(async () => ({
        query: mockPoolQuery,
        release: mockRelease,
      }));

      // Act
      await createTenantSchema("company-123");

      // Assert
      expect(mockRelease).toHaveBeenCalled();
    });

    it("should release connection even on error", async () => {
      // Arrange
      const mockRelease = mock(() => {});
      const mockQueryError = mock(async () => {
        throw new Error("Database error");
      });
      mockPoolConnect.mockImplementation(async () => ({
        query: mockQueryError,
        release: mockRelease,
      }));

      // Act & Assert
      await expect(createTenantSchema("company-123")).rejects.toThrow("Database error");
      expect(mockRelease).toHaveBeenCalled();
    });
  });

  describe("dropTenantSchema", () => {
    it("should call drop_tenant_schema SQL function", async () => {
      // Arrange
      const companyId = "company-123";
      const expectedSchemaName = "tenant_company_123";

      // Act
      await dropTenantSchema(companyId);

      // Assert
      expect(mockPoolQuery).toHaveBeenCalledWith(
        "SELECT drop_tenant_schema($1)",
        [expectedSchemaName]
      );
    });

    it("should release connection after execution", async () => {
      // Arrange
      const mockRelease = mock(() => {});
      mockPoolConnect.mockImplementation(async () => ({
        query: mockPoolQuery,
        release: mockRelease,
      }));

      // Act
      await dropTenantSchema("company-123");

      // Assert
      expect(mockRelease).toHaveBeenCalled();
    });

    it("should clear cached connection when dropping schema", async () => {
      // First get a connection to cache it
      getTenantConnection("company-123");

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
      expect(mockKyselyWithSchema).toHaveBeenCalledWith("tenant_company_123");
    });

    it("should cache connections for the same company", () => {
      // Act
      const first = getTenantConnection("company-123");
      const second = getTenantConnection("company-123");

      // Assert - should return cached connection, withSchema called only once per unique company
      expect(first).toBe(second);
    });

    it("should create separate connections for different companies", () => {
      // Act
      const first = getTenantConnection("company-1");
      const second = getTenantConnection("company-2");

      // Assert - both should have called withSchema
      expect(mockKyselyWithSchema).toHaveBeenCalledWith("tenant_company_1");
      expect(mockKyselyWithSchema).toHaveBeenCalledWith("tenant_company_2");
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
      // Create multiple connections
      getTenantConnection("company-1");
      getTenantConnection("company-2");
      getTenantConnection("company-3");

      // Act
      await clearAllTenantConnections();

      // Assert - destroy should be called for each connection
      expect(mockKyselyDestroy).toHaveBeenCalled();
    });

    it("should end the main pool", async () => {
      // First get a connection to initialize the pool
      getTenantConnection("company-123");

      // Act
      await clearAllTenantConnections();

      // Assert
      expect(mockPoolEnd).toHaveBeenCalled();
    });

    it("should handle empty cache gracefully", async () => {
      // Act & Assert - should not throw
      await expect(clearAllTenantConnections()).resolves.toBeUndefined();
    });
  });

  describe("tenantSchemaExists", () => {
    it("should return true if schema exists", async () => {
      // Arrange
      mockPoolQuery.mockImplementation(async () => ({
        rows: [{ schema_name: "tenant_company_123" }],
      }));

      // Act
      const result = await tenantSchemaExists("company-123");

      // Assert
      expect(result).toBe(true);
    });

    it("should return false if schema does not exist", async () => {
      // Arrange
      mockPoolQuery.mockImplementation(async () => ({
        rows: [],
      }));

      // Act
      const result = await tenantSchemaExists("non-existent");

      // Assert
      expect(result).toBe(false);
    });

    it("should query information_schema.schemata", async () => {
      // Act
      await tenantSchemaExists("company-123");

      // Assert
      expect(mockPoolQuery).toHaveBeenCalledWith(
        "SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1",
        ["tenant_company_123"]
      );
    });

    it("should release connection after checking", async () => {
      // Arrange
      const mockRelease = mock(() => {});
      mockPoolConnect.mockImplementation(async () => ({
        query: mockPoolQuery,
        release: mockRelease,
      }));

      // Act
      await tenantSchemaExists("company-123");

      // Assert
      expect(mockRelease).toHaveBeenCalled();
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
