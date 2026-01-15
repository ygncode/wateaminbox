/**
 * Unit tests for audit.service.ts
 *
 * Tests audit logging functionality including:
 * - Creating audit log entries
 * - Querying audit logs with filters
 * - IP address extraction from headers
 */

import { describe, it, expect, mock, beforeEach, spyOn } from "bun:test";
import {
  createMockAuditLog,
  createMutableMockQueryBuilder,
  resetMockQueryBuilder,
} from "../mocks";

// Mock query builder - using centralized mock utilities
let mockQueryBuilder = createMutableMockQueryBuilder();

// Mock tenant database
const mockTenantDb = {
  insertInto: mock(() => mockQueryBuilder),
  selectFrom: mock(() => mockQueryBuilder),
};

// Mock getTenantConnection
const mockGetTenantConnection = mock((_companyId: string) => mockTenantDb);

mock.module("../../services/tenant.service.js", () => ({
  getTenantConnection: mockGetTenantConnection,
}));

// Note: We don't mock the logger - let it log normally to verify the service
// doesn't throw errors even when database operations fail

// Import the service after mocking
import {
  createAuditLog,
  getAuditLogs,
  getClientIp,
  type AuditAction,
  type CreateAuditLogInput,
} from "../../services/audit.service";

describe("AuditService", () => {
  beforeEach(() => {
    resetMockQueryBuilder(mockQueryBuilder);
    mockGetTenantConnection.mockClear();
    mockTenantDb.insertInto = mock(() => mockQueryBuilder);
    mockTenantDb.selectFrom = mock(() => mockQueryBuilder);
  });

  describe("createAuditLog", () => {
    it("should create audit log entry with all fields", async () => {
      // Arrange
      const input: CreateAuditLogInput = {
        companyId: "company-123",
        userId: "user-123",
        action: "user.login" as AuditAction,
        entityType: "user",
        entityId: "user-123",
        details: { browser: "Chrome", os: "MacOS" },
        ipAddress: "192.168.1.1",
      };

      // Act
      await createAuditLog(input);

      // Assert
      expect(mockGetTenantConnection).toHaveBeenCalledWith("company-123");
      expect(mockTenantDb.insertInto).toHaveBeenCalled();
    });

    it("should create audit log entry with minimal fields", async () => {
      // Arrange
      const input: CreateAuditLogInput = {
        companyId: "company-123",
        userId: null,
        action: "user.logout" as AuditAction,
      };

      // Act
      await createAuditLog(input);

      // Assert
      expect(mockGetTenantConnection).toHaveBeenCalledWith("company-123");
      expect(mockTenantDb.insertInto).toHaveBeenCalled();
    });

    it("should not throw error on database failure", async () => {
      // Arrange
      const input: CreateAuditLogInput = {
        companyId: "company-123",
        userId: "user-123",
        action: "user.login" as AuditAction,
      };

      mockTenantDb.insertInto = mock(() => {
        throw new Error("Database error");
      });

      // Act & Assert - should not throw even when database fails
      // The error is logged internally but the function should not propagate it
      await expect(createAuditLog(input)).resolves.toBeUndefined();
    });

    it("should handle different audit actions", async () => {
      // Test various action types
      const actions: AuditAction[] = [
        "user.login",
        "user.logout",
        "invitation.sent",
        "invitation.accepted",
        "invitation.cancelled",
        "invitation.resent",
        "member.role_changed",
        "member.removed",
        "contact.created",
        "contact.updated",
        "contact.assigned",
        "contact.unassigned",
        "message.sent",
        "message.deleted",
        "tag.created",
        "tag.deleted",
        "company.updated",
      ];

      for (const action of actions) {
        const input: CreateAuditLogInput = {
          companyId: "company-123",
          userId: "user-123",
          action,
        };

        // Should not throw for any valid action
        await expect(createAuditLog(input)).resolves.toBeUndefined();
      }
    });
  });

  describe("getAuditLogs", () => {
    it("should return paginated audit logs", async () => {
      // Arrange
      const mockLogs = [
        createMockAuditLog({ id: "log-1", action: "user.login" }),
        createMockAuditLog({ id: "log-2", action: "user.logout" }),
      ];

      resetMockQueryBuilder(mockQueryBuilder, mockLogs);
      mockQueryBuilder.execute = mock(() => Promise.resolve(mockLogs));

      // For count query
      let queryCount = 0;
      mockTenantDb.selectFrom = mock(() => {
        queryCount++;
        if (queryCount === 1) {
          // Main query
          return mockQueryBuilder;
        }
        // Count query
        return {
          ...mockQueryBuilder,
          select: mock(() => ({
            ...mockQueryBuilder,
            executeTakeFirst: mock(() => Promise.resolve({ total: 2 })),
          })),
        };
      });

      // Act
      const result = await getAuditLogs({
        companyId: "company-123",
        limit: 50,
        offset: 0,
      });

      // Assert
      expect(result.logs).toBeDefined();
      expect(Array.isArray(result.logs)).toBe(true);
      expect(result.total).toBeDefined();
    });

    it("should filter by userId", async () => {
      // Arrange
      const mockLogs = [createMockAuditLog({ user_id: "specific-user" })];
      resetMockQueryBuilder(mockQueryBuilder, mockLogs);
      mockQueryBuilder.execute = mock(() => Promise.resolve(mockLogs));
      mockTenantDb.selectFrom = mock(() => ({
        ...mockQueryBuilder,
        select: mock(() => ({
          ...mockQueryBuilder,
          executeTakeFirst: mock(() => Promise.resolve({ total: 1 })),
        })),
      }));

      // Act
      const result = await getAuditLogs({
        companyId: "company-123",
        userId: "specific-user",
      });

      // Assert
      expect(result.logs).toBeDefined();
      expect(mockQueryBuilder.where).toHaveBeenCalled();
    });

    it("should filter by action", async () => {
      // Arrange
      const mockLogs = [createMockAuditLog({ action: "user.login" })];
      resetMockQueryBuilder(mockQueryBuilder, mockLogs);
      mockQueryBuilder.execute = mock(() => Promise.resolve(mockLogs));
      mockTenantDb.selectFrom = mock(() => ({
        ...mockQueryBuilder,
        select: mock(() => ({
          ...mockQueryBuilder,
          executeTakeFirst: mock(() => Promise.resolve({ total: 1 })),
        })),
      }));

      // Act
      const result = await getAuditLogs({
        companyId: "company-123",
        action: "user.login" as AuditAction,
      });

      // Assert
      expect(result.logs).toBeDefined();
    });

    it("should filter by entityType and entityId", async () => {
      // Arrange
      const mockLogs = [
        createMockAuditLog({
          entity_type: "contact",
          entity_id: "contact-123",
        }),
      ];
      resetMockQueryBuilder(mockQueryBuilder, mockLogs);
      mockQueryBuilder.execute = mock(() => Promise.resolve(mockLogs));
      mockTenantDb.selectFrom = mock(() => ({
        ...mockQueryBuilder,
        select: mock(() => ({
          ...mockQueryBuilder,
          executeTakeFirst: mock(() => Promise.resolve({ total: 1 })),
        })),
      }));

      // Act
      const result = await getAuditLogs({
        companyId: "company-123",
        entityType: "contact",
        entityId: "contact-123",
      });

      // Assert
      expect(result.logs).toBeDefined();
    });

    it("should filter by date range", async () => {
      // Arrange
      const startDate = new Date("2024-01-01");
      const endDate = new Date("2024-01-31");
      const mockLogs = [createMockAuditLog()];

      resetMockQueryBuilder(mockQueryBuilder, mockLogs);
      mockQueryBuilder.execute = mock(() => Promise.resolve(mockLogs));
      mockTenantDb.selectFrom = mock(() => ({
        ...mockQueryBuilder,
        select: mock(() => ({
          ...mockQueryBuilder,
          executeTakeFirst: mock(() => Promise.resolve({ total: 1 })),
        })),
      }));

      // Act
      const result = await getAuditLogs({
        companyId: "company-123",
        startDate,
        endDate,
      });

      // Assert
      expect(result.logs).toBeDefined();
    });

    it("should use default pagination values", async () => {
      // Arrange
      resetMockQueryBuilder(mockQueryBuilder, []);
      mockQueryBuilder.execute = mock(() => Promise.resolve([]));
      mockTenantDb.selectFrom = mock(() => ({
        ...mockQueryBuilder,
        select: mock(() => ({
          ...mockQueryBuilder,
          executeTakeFirst: mock(() => Promise.resolve({ total: 0 })),
        })),
      }));

      // Act
      const result = await getAuditLogs({
        companyId: "company-123",
        // No limit or offset provided
      });

      // Assert
      expect(result.logs).toBeDefined();
      expect(result.total).toBe(0);
    });

    it("should return empty array when no logs found", async () => {
      // Arrange
      resetMockQueryBuilder(mockQueryBuilder, []);
      mockQueryBuilder.execute = mock(() => Promise.resolve([]));
      mockTenantDb.selectFrom = mock(() => ({
        ...mockQueryBuilder,
        select: mock(() => ({
          ...mockQueryBuilder,
          executeTakeFirst: mock(() => Promise.resolve({ total: 0 })),
        })),
      }));

      // Act
      const result = await getAuditLogs({
        companyId: "company-123",
      });

      // Assert
      expect(result.logs).toEqual([]);
      expect(result.total).toBe(0);
    });

    it("should map database fields to API response format", async () => {
      // Arrange
      const dbLog = {
        id: "log-123",
        user_id: "user-123",
        action: "user.login",
        entity_type: "user",
        entity_id: "user-123",
        details: { browser: "Chrome" },
        ip_address: "192.168.1.1",
        created_at: new Date(),
      };

      resetMockQueryBuilder(mockQueryBuilder, [dbLog]);
      mockQueryBuilder.execute = mock(() => Promise.resolve([dbLog]));
      mockTenantDb.selectFrom = mock(() => ({
        ...mockQueryBuilder,
        select: mock(() => ({
          ...mockQueryBuilder,
          executeTakeFirst: mock(() => Promise.resolve({ total: 1 })),
        })),
      }));

      // Act
      const result = await getAuditLogs({ companyId: "company-123" });

      // Assert
      expect(result.logs.length).toBe(1);
      const log = result.logs[0];
      expect(log.id).toBe("log-123");
      expect(log.userId).toBe("user-123");
      expect(log.action).toBe("user.login");
      expect(log.entityType).toBe("user");
      expect(log.entityId).toBe("user-123");
      expect(log.details).toEqual({ browser: "Chrome" });
      expect(log.ipAddress).toBe("192.168.1.1");
      expect(log.createdAt).toBeDefined();
    });
  });

  describe("getClientIp", () => {
    it("should extract IP from x-forwarded-for header", () => {
      // Arrange
      const headers = new Headers({
        "x-forwarded-for": "192.168.1.1, 10.0.0.1",
      });

      // Act
      const result = getClientIp(headers);

      // Assert
      expect(result).toBe("192.168.1.1");
    });

    it("should extract IP from x-real-ip header", () => {
      // Arrange
      const headers = new Headers({
        "x-real-ip": "192.168.1.2",
      });

      // Act
      const result = getClientIp(headers);

      // Assert
      expect(result).toBe("192.168.1.2");
    });

    it("should prefer x-forwarded-for over x-real-ip", () => {
      // Arrange
      const headers = new Headers({
        "x-forwarded-for": "192.168.1.1",
        "x-real-ip": "192.168.1.2",
      });

      // Act
      const result = getClientIp(headers);

      // Assert
      expect(result).toBe("192.168.1.1");
    });

    it("should return undefined when no IP headers present", () => {
      // Arrange
      const headers = new Headers({
        "content-type": "application/json",
      });

      // Act
      const result = getClientIp(headers);

      // Assert
      expect(result).toBeUndefined();
    });

    it("should trim whitespace from IP address", () => {
      // Arrange
      const headers = new Headers({
        "x-forwarded-for": "  192.168.1.1  , 10.0.0.1",
      });

      // Act
      const result = getClientIp(headers);

      // Assert
      expect(result).toBe("192.168.1.1");
    });

    it("should handle empty x-forwarded-for header", () => {
      // Arrange
      const headers = new Headers({
        "x-forwarded-for": "",
        "x-real-ip": "192.168.1.2",
      });

      // Act
      const result = getClientIp(headers);

      // Assert
      expect(result).toBe("192.168.1.2");
    });
  });
});
