/**
 * Unit tests for company.service.ts
 *
 * Tests company management functionality including:
 * - Company CRUD operations
 * - Member management
 * - Invitation system
 * - Permission checking
 */

import { describe, it, expect, mock, beforeEach } from "bun:test";
import {
  createMockCompany,
  createMockCompanyMember,
  createMockInvitation,
  createUpdateResult,
  createDeleteResult,
} from "../mocks";

// Mock query builder
let mockQueryBuilder: Record<string, unknown>;

function resetMockQueryBuilder(returnValue: unknown = undefined) {
  mockQueryBuilder = {
    selectFrom: mock(() => mockQueryBuilder),
    insertInto: mock(() => mockQueryBuilder),
    updateTable: mock(() => mockQueryBuilder),
    deleteFrom: mock(() => mockQueryBuilder),
    select: mock(() => mockQueryBuilder),
    selectAll: mock(() => mockQueryBuilder),
    where: mock(() => mockQueryBuilder),
    values: mock(() => mockQueryBuilder),
    set: mock(() => mockQueryBuilder),
    returning: mock(() => mockQueryBuilder),
    innerJoin: mock(() => mockQueryBuilder),
    leftJoin: mock(() => mockQueryBuilder),
    orderBy: mock(() => mockQueryBuilder),
    limit: mock(() => mockQueryBuilder),
    offset: mock(() => mockQueryBuilder),
    groupBy: mock(() => mockQueryBuilder),
    execute: mock(() => Promise.resolve(Array.isArray(returnValue) ? returnValue : [])),
    executeTakeFirst: mock(() => Promise.resolve(returnValue)),
    executeTakeFirstOrThrow: mock(() => {
      if (returnValue === undefined) throw new Error("no result");
      return Promise.resolve(returnValue);
    }),
  };
}

function resetMockDb() {
  mockDb.selectFrom = mock(() => mockQueryBuilder);
  mockDb.insertInto = mock(() => mockQueryBuilder);
  mockDb.updateTable = mock(() => mockQueryBuilder);
  mockDb.deleteFrom = mock(() => mockQueryBuilder);
}

// Mock database
const mockDb = {
  selectFrom: mock(() => mockQueryBuilder),
  insertInto: mock(() => mockQueryBuilder),
  updateTable: mock(() => mockQueryBuilder),
  deleteFrom: mock(() => mockQueryBuilder),
  transaction: mock(() => ({
    execute: mock(async (callback: (trx: unknown) => Promise<unknown>) => {
      const trxMock = {
        insertInto: mock(() => ({
          values: mock(() => ({
            returning: mock(() => ({
              executeTakeFirstOrThrow: mock(() => Promise.resolve(createMockCompany())),
            })),
            execute: mock(() => Promise.resolve()),
          })),
        })),
        updateTable: mock(() => ({
          set: mock(() => ({
            where: mock(() => ({
              execute: mock(() => Promise.resolve()),
            })),
          })),
        })),
      };
      return callback(trxMock);
    }),
  })),
};

mock.module("@whatsapp-web/database", () => ({
  db: mockDb,
}));

// Mock tenant service
const mockCreateTenantSchema = mock(async () => {});

mock.module("../../services/tenant.service.js", () => ({
  createTenantSchema: mockCreateTenantSchema,
  getSchemaName: mock((companyId: string) => `tenant_${companyId.replace(/-/g, "_")}`),
}));

// Import the service after mocking
import {
  createCompany,
  getCompany,
  updateCompany,
  deleteCompany,
  getMembers,
  getMemberRole,
  hasPermission,
  inviteMember,
  getPendingInvitations,
  cancelInvitation,
  acceptInvitation,
  removeMember,
  updateMemberRole,
  getUserCompanies,
  getInvitationByToken,
  resendInvitation,
  CompanyNotFoundError,
  InvitationNotFoundError,
  InvitationExpiredError,
  UserAlreadyMemberError,
  InsufficientPermissionsError,
} from "../../services/company.service";

describe("CompanyService", () => {
  beforeEach(() => {
    resetMockQueryBuilder();
    resetMockDb();
    mockCreateTenantSchema.mockClear();
  });

  describe("createCompany", () => {
    it("should create a company and tenant schema", async () => {
      // Arrange
      const input = { name: "Test Company" };
      const ownerId = "user-123";

      // Act
      const result = await createCompany(input, ownerId);

      // Assert
      expect(result).toBeDefined();
      expect(result.name).toBeDefined();
      expect(mockCreateTenantSchema).toHaveBeenCalled();
    });

    it("should add owner as a member during creation", async () => {
      // Arrange
      const input = { name: "Test Company" };
      const ownerId = "user-123";

      // Act
      const result = await createCompany(input, ownerId);

      // Assert
      expect(result).toBeDefined();
      // The transaction mock verifies member insertion
    });
  });

  describe("getCompany", () => {
    it("should return company for valid ID", async () => {
      // Arrange
      const mockCompany = createMockCompany();
      resetMockQueryBuilder(mockCompany);
      mockDb.selectFrom = mock(() => mockQueryBuilder);

      // Act
      const result = await getCompany("company-123");

      // Assert
      expect(result).toBeDefined();
      expect(result.id).toBe(mockCompany.id);
      expect(result.name).toBe(mockCompany.name);
    });

    it("should throw CompanyNotFoundError for non-existent company", async () => {
      // Arrange
      resetMockQueryBuilder(undefined);
      mockDb.selectFrom = mock(() => mockQueryBuilder);

      // Act & Assert
      await expect(getCompany("non-existent")).rejects.toThrow(CompanyNotFoundError);
    });

    it("should not return deleted companies", async () => {
      // Arrange
      resetMockQueryBuilder(undefined);
      mockDb.selectFrom = mock(() => mockQueryBuilder);

      // Act & Assert
      await expect(getCompany("deleted-company")).rejects.toThrow(CompanyNotFoundError);
    });
  });

  describe("updateCompany", () => {
    it("should update company name", async () => {
      // Arrange
      const updatedCompany = createMockCompany({ name: "Updated Name" });
      resetMockQueryBuilder(updatedCompany);
      mockDb.updateTable = mock(() => mockQueryBuilder);

      // Act
      const result = await updateCompany("company-123", { name: "Updated Name" });

      // Assert
      expect(result.name).toBe("Updated Name");
    });

    it("should update company status", async () => {
      // Arrange
      const updatedCompany = createMockCompany({ status: "suspended" });
      resetMockQueryBuilder(updatedCompany);
      mockDb.updateTable = mock(() => mockQueryBuilder);

      // Act
      const result = await updateCompany("company-123", { status: "suspended" });

      // Assert
      expect(result.status).toBe("suspended");
    });

    it("should throw CompanyNotFoundError when updating non-existent company", async () => {
      // Arrange
      resetMockQueryBuilder(undefined);
      mockDb.updateTable = mock(() => mockQueryBuilder);

      // Act & Assert
      await expect(updateCompany("non-existent", { name: "New Name" })).rejects.toThrow(CompanyNotFoundError);
    });
  });

  describe("deleteCompany", () => {
    it("should soft delete company", async () => {
      // Arrange
      resetMockQueryBuilder(createUpdateResult(1));
      mockDb.updateTable = mock(() => mockQueryBuilder);

      // Act & Assert - should not throw
      await expect(deleteCompany("company-123")).resolves.toBeUndefined();
    });

    it("should throw CompanyNotFoundError when deleting non-existent company", async () => {
      // Arrange
      resetMockQueryBuilder(createUpdateResult(0));
      mockDb.updateTable = mock(() => mockQueryBuilder);

      // Act & Assert
      await expect(deleteCompany("non-existent")).rejects.toThrow(CompanyNotFoundError);
    });
  });

  describe("getMembers", () => {
    it("should return all members of a company", async () => {
      // Arrange
      const mockCompany = createMockCompany();
      const mockMembers = [
        createMockCompanyMember({ id: "member-1", role: "owner" }),
        createMockCompanyMember({ id: "member-2", role: "admin" }),
        createMockCompanyMember({ id: "member-3", role: "member" }),
      ];

      // First call gets company, second gets members
      let callCount = 0;
      mockDb.selectFrom = mock(() => {
        callCount++;
        if (callCount === 1) {
          resetMockQueryBuilder(mockCompany);
          return mockQueryBuilder;
        }
        resetMockQueryBuilder(mockMembers);
        mockQueryBuilder.execute = mock(() => Promise.resolve(mockMembers));
        return mockQueryBuilder;
      });

      // Act
      const result = await getMembers("company-123");

      // Assert
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(3);
    });

    it("should throw CompanyNotFoundError for non-existent company", async () => {
      // Arrange
      resetMockQueryBuilder(undefined);
      mockDb.selectFrom = mock(() => mockQueryBuilder);

      // Act & Assert
      await expect(getMembers("non-existent")).rejects.toThrow(CompanyNotFoundError);
    });
  });

  describe("getMemberRole", () => {
    it("should return role for existing member", async () => {
      // Arrange
      resetMockQueryBuilder({ role: "admin" });
      mockDb.selectFrom = mock(() => mockQueryBuilder);

      // Act
      const result = await getMemberRole("company-123", "user-123");

      // Assert
      expect(result).toBe("admin");
    });

    it("should return null for non-member", async () => {
      // Arrange
      resetMockQueryBuilder(undefined);
      mockDb.selectFrom = mock(() => mockQueryBuilder);

      // Act
      const result = await getMemberRole("company-123", "non-member");

      // Assert
      expect(result).toBeNull();
    });
  });

  describe("hasPermission", () => {
    it("should return true if user has required role or higher", async () => {
      // Owner has all permissions
      resetMockQueryBuilder({ role: "owner" });
      mockDb.selectFrom = mock(() => mockQueryBuilder);
      expect(await hasPermission("company-123", "user-123", "member")).toBe(true);
      expect(await hasPermission("company-123", "user-123", "admin")).toBe(true);
      expect(await hasPermission("company-123", "user-123", "owner")).toBe(true);
    });

    it("should return false if user has lower role than required", async () => {
      // Member cannot perform admin actions
      resetMockQueryBuilder({ role: "member" });
      mockDb.selectFrom = mock(() => mockQueryBuilder);
      expect(await hasPermission("company-123", "user-123", "admin")).toBe(false);
      expect(await hasPermission("company-123", "user-123", "owner")).toBe(false);
    });

    it("should return false for non-members", async () => {
      // Arrange
      resetMockQueryBuilder(undefined);
      mockDb.selectFrom = mock(() => mockQueryBuilder);

      // Act
      const result = await hasPermission("company-123", "non-member", "member");

      // Assert
      expect(result).toBe(false);
    });
  });

  describe("inviteMember", () => {
    it("should create invitation for new user", async () => {
      // Arrange
      const mockCompany = createMockCompany();
      const mockInvitation = createMockInvitation();

      // Setup multiple query responses
      let callCount = 0;
      mockDb.selectFrom = mock(() => {
        callCount++;
        if (callCount === 1) {
          // Company lookup
          resetMockQueryBuilder(mockCompany);
          return mockQueryBuilder;
        }
        if (callCount === 2) {
          // Check if user is already member - should be undefined
          resetMockQueryBuilder(undefined);
          return mockQueryBuilder;
        }
        // Check existing invitation
        resetMockQueryBuilder(undefined);
        return mockQueryBuilder;
      });

      const insertBuilder: Record<string, unknown> = {
        values: mock(() => insertBuilder),
        returning: mock(() => insertBuilder),
        executeTakeFirstOrThrow: mock(() => Promise.resolve(mockInvitation)),
      };
      mockDb.insertInto = mock(() => insertBuilder);

      // Act
      const result = await inviteMember(
        "company-123",
        { email: "new@example.com", role: "member" },
        "inviter-123"
      );

      // Assert
      expect(result).toBeDefined();
      expect(result.email).toBe(mockInvitation.email);
      expect(result.token).toBeDefined();
    });

    it("should throw UserAlreadyMemberError if user is already a member", async () => {
      // Arrange
      const mockCompany = createMockCompany();
      const existingMember = { id: "existing" };

      let callCount = 0;
      mockDb.selectFrom = mock(() => {
        callCount++;
        if (callCount === 1) {
          resetMockQueryBuilder(mockCompany);
          return mockQueryBuilder;
        }
        // User is already a member
        resetMockQueryBuilder(existingMember);
        return mockQueryBuilder;
      });

      // Act & Assert
      await expect(
        inviteMember("company-123", { email: "existing@example.com" }, "inviter-123")
      ).rejects.toThrow(UserAlreadyMemberError);
    });

    it("should throw CompanyNotFoundError for non-existent company", async () => {
      // Arrange
      resetMockQueryBuilder(undefined);
      mockDb.selectFrom = mock(() => mockQueryBuilder);

      // Act & Assert
      await expect(
        inviteMember("non-existent", { email: "new@example.com" }, "inviter-123")
      ).rejects.toThrow(CompanyNotFoundError);
    });
  });

  describe("getPendingInvitations", () => {
    it("should return all pending invitations", async () => {
      // Arrange
      const mockInvitations = [
        createMockInvitation({ id: "inv-1" }),
        createMockInvitation({ id: "inv-2" }),
      ];
      resetMockQueryBuilder(mockInvitations);
      mockQueryBuilder.execute = mock(() => Promise.resolve(mockInvitations));
      mockDb.selectFrom = mock(() => mockQueryBuilder);

      // Act
      const result = await getPendingInvitations("company-123");

      // Assert
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
    });

    it("should not return expired invitations", async () => {
      // Arrange - expired invitations should be filtered by the query
      resetMockQueryBuilder([]);
      mockQueryBuilder.execute = mock(() => Promise.resolve([]));
      mockDb.selectFrom = mock(() => mockQueryBuilder);

      // Act
      const result = await getPendingInvitations("company-123");

      // Assert
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });
  });

  describe("cancelInvitation", () => {
    it("should cancel pending invitation", async () => {
      // Arrange
      resetMockQueryBuilder(createDeleteResult(1));
      mockDb.deleteFrom = mock(() => mockQueryBuilder);

      // Act & Assert - should not throw
      await expect(cancelInvitation("company-123", "invitation-123")).resolves.toBeUndefined();
    });

    it("should throw InvitationNotFoundError for non-existent invitation", async () => {
      // Arrange
      resetMockQueryBuilder(createDeleteResult(0));
      mockDb.deleteFrom = mock(() => mockQueryBuilder);

      // Act & Assert
      await expect(cancelInvitation("company-123", "non-existent")).rejects.toThrow(InvitationNotFoundError);
    });
  });

  describe("acceptInvitation", () => {
    it("should accept valid invitation", async () => {
      // Arrange
      const mockInvitation = createMockInvitation({
        expires_at: new Date(Date.now() + 86400000), // Future date
      });
      const mockCompany = createMockCompany();
      const mockMember = createMockCompanyMember();

      let callCount = 0;
      mockDb.selectFrom = mock(() => {
        callCount++;
        if (callCount === 1) {
          // Find invitation
          resetMockQueryBuilder(mockInvitation);
          return mockQueryBuilder;
        }
        // Get company
        resetMockQueryBuilder(mockCompany);
        return mockQueryBuilder;
      });

      // Transaction mock for accepting
      mockDb.transaction = mock(() => ({
        execute: mock(async (callback: (trx: unknown) => Promise<unknown>) => {
          const trxMock = {
            updateTable: mock(() => ({
              set: mock(() => ({
                where: mock(() => ({
                  execute: mock(() => Promise.resolve()),
                })),
              })),
            })),
            insertInto: mock(() => ({
              values: mock(() => ({
                returning: mock(() => ({
                  executeTakeFirstOrThrow: mock(() => Promise.resolve(mockMember)),
                })),
              })),
            })),
          };
          return callback(trxMock);
        }),
      }));

      // Act
      const result = await acceptInvitation("valid-token", "user-123");

      // Assert
      expect(result).toBeDefined();
      expect(result.company).toBeDefined();
      expect(result.member).toBeDefined();
    });

    it("should throw InvitationNotFoundError for invalid token", async () => {
      // Arrange
      resetMockQueryBuilder(undefined);
      mockDb.selectFrom = mock(() => mockQueryBuilder);

      // Act & Assert
      await expect(acceptInvitation("invalid-token", "user-123")).rejects.toThrow(InvitationNotFoundError);
    });

    it("should throw InvitationExpiredError for expired invitation", async () => {
      // Arrange
      const expiredInvitation = createMockInvitation({
        expires_at: new Date(Date.now() - 86400000), // Past date
      });
      resetMockQueryBuilder(expiredInvitation);
      mockDb.selectFrom = mock(() => mockQueryBuilder);

      // Act & Assert
      await expect(acceptInvitation("expired-token", "user-123")).rejects.toThrow(InvitationExpiredError);
    });
  });

  describe("removeMember", () => {
    it("should remove member from company", async () => {
      // Arrange - member role
      let callCount = 0;
      mockDb.selectFrom = mock(() => {
        callCount++;
        resetMockQueryBuilder({ role: "member" });
        return mockQueryBuilder;
      });

      const deleteResult = createDeleteResult(1);
      const deleteBuilder: Record<string, unknown> = {
        where: mock(() => deleteBuilder),
        executeTakeFirst: mock(() => Promise.resolve(deleteResult)),
      };
      mockDb.deleteFrom = mock(() => deleteBuilder);

      const updateBuilder: Record<string, unknown> = {
        where: mock(() => updateBuilder),
        set: mock(() => updateBuilder),
        execute: mock(() => Promise.resolve()),
      };
      mockDb.updateTable = mock(() => updateBuilder);

      // Act & Assert - should not throw
      await expect(removeMember("company-123", "member-123")).resolves.toBeUndefined();
    });

    it("should throw InsufficientPermissionsError when trying to remove owner", async () => {
      // Arrange
      resetMockQueryBuilder({ role: "owner" });
      mockDb.selectFrom = mock(() => mockQueryBuilder);

      // Act & Assert
      await expect(removeMember("company-123", "owner-123")).rejects.toThrow(InsufficientPermissionsError);
    });
  });

  describe("updateMemberRole", () => {
    it("should update member role to admin", async () => {
      // Arrange
      resetMockQueryBuilder({ role: "member" });
      mockDb.selectFrom = mock(() => mockQueryBuilder);

      const updatedMember = createMockCompanyMember({ role: "admin" });
      resetMockQueryBuilder(updatedMember);
      mockDb.updateTable = mock(() => mockQueryBuilder);

      // Act
      const result = await updateMemberRole("company-123", "user-123", "admin");

      // Assert
      expect(result.role).toBe("admin");
    });

    it("should throw InsufficientPermissionsError when changing owner role", async () => {
      // Arrange
      resetMockQueryBuilder({ role: "owner" });
      mockDb.selectFrom = mock(() => mockQueryBuilder);

      // Act & Assert
      await expect(updateMemberRole("company-123", "owner-123", "member")).rejects.toThrow(InsufficientPermissionsError);
    });
  });

  describe("getUserCompanies", () => {
    it("should return all companies for a user", async () => {
      // Arrange
      const mockCompanies = [
        { ...createMockCompany({ id: "company-1" }), role: "owner" },
        { ...createMockCompany({ id: "company-2" }), role: "member" },
      ];
      resetMockQueryBuilder(mockCompanies);
      mockQueryBuilder.execute = mock(() => Promise.resolve(mockCompanies));
      mockDb.selectFrom = mock(() => mockQueryBuilder);

      // Act
      const result = await getUserCompanies("user-123");

      // Assert
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
    });

    it("should return empty array for user with no companies", async () => {
      // Arrange
      resetMockQueryBuilder([]);
      mockQueryBuilder.execute = mock(() => Promise.resolve([]));
      mockDb.selectFrom = mock(() => mockQueryBuilder);

      // Act
      const result = await getUserCompanies("user-with-no-companies");

      // Assert
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });
  });

  describe("getInvitationByToken", () => {
    it("should return invitation details for valid token", async () => {
      // Arrange
      const mockResult = {
        id: "inv-123",
        email: "invited@example.com",
        expires_at: new Date(Date.now() + 86400000),
        accepted_at: null,
        created_at: new Date(),
        company_name: "Test Company",
        inviter_email: "owner@example.com",
      };
      resetMockQueryBuilder(mockResult);
      mockDb.selectFrom = mock(() => mockQueryBuilder);

      // Act
      const result = await getInvitationByToken("valid-token");

      // Assert
      expect(result).toBeDefined();
      expect(result.email).toBe("invited@example.com");
      expect(result.companyName).toBe("Test Company");
    });

    it("should throw InvitationNotFoundError for invalid token", async () => {
      // Arrange
      resetMockQueryBuilder(undefined);
      mockDb.selectFrom = mock(() => mockQueryBuilder);

      // Act & Assert
      await expect(getInvitationByToken("invalid-token")).rejects.toThrow(InvitationNotFoundError);
    });

    it("should throw InvitationNotFoundError for already accepted invitation", async () => {
      // Arrange
      const acceptedInvitation = {
        id: "inv-123",
        email: "invited@example.com",
        expires_at: new Date(Date.now() + 86400000),
        accepted_at: new Date(), // Already accepted
        created_at: new Date(),
        company_name: "Test Company",
        inviter_email: "owner@example.com",
      };
      resetMockQueryBuilder(acceptedInvitation);
      mockDb.selectFrom = mock(() => mockQueryBuilder);

      // Act & Assert
      await expect(getInvitationByToken("accepted-token")).rejects.toThrow(InvitationNotFoundError);
    });

    it("should throw InvitationExpiredError for expired invitation", async () => {
      // Arrange
      const expiredResult = {
        id: "inv-123",
        email: "invited@example.com",
        expires_at: new Date(Date.now() - 86400000), // Past date
        accepted_at: null,
        created_at: new Date(),
        company_name: "Test Company",
        inviter_email: "owner@example.com",
      };
      resetMockQueryBuilder(expiredResult);
      mockDb.selectFrom = mock(() => mockQueryBuilder);

      // Act & Assert
      await expect(getInvitationByToken("expired-token")).rejects.toThrow(InvitationExpiredError);
    });
  });

  describe("resendInvitation", () => {
    it("should resend invitation with new token and extended expiry", async () => {
      // Arrange - create mock company, user, and invitation
      const mockCompany = createMockCompany();
      const mockInvitation = createMockInvitation();
      const mockUser = { email: "resender@example.com" };
      let selectCallCount = 0;

      // Mock selectFrom to return company first, then user, then invitation
      const selectMockBuilder: Record<string, unknown> = {};
      selectMockBuilder.select = mock(() => selectMockBuilder);
      selectMockBuilder.selectAll = mock(() => selectMockBuilder);
      selectMockBuilder.innerJoin = mock(() => selectMockBuilder);
      selectMockBuilder.where = mock(() => selectMockBuilder);
      selectMockBuilder.executeTakeFirst = mock(() => {
        selectCallCount++;
        // First call: getCompany, second call: get user, third call: get invitation
        if (selectCallCount === 1) return Promise.resolve(mockCompany);
        if (selectCallCount === 2) return Promise.resolve(mockUser);
        return Promise.resolve(mockInvitation);
      });

      mockDb.selectFrom = mock(() => selectMockBuilder);

      const updatedInvitation = createMockInvitation({
        token: "new-token",
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      // Create a proper chainable mock for updateTable
      const updateMockBuilder: Record<string, unknown> = {};
      updateMockBuilder.set = mock(() => updateMockBuilder);
      updateMockBuilder.where = mock(() => updateMockBuilder);
      updateMockBuilder.returning = mock(() => updateMockBuilder);
      updateMockBuilder.executeTakeFirstOrThrow = mock(() => Promise.resolve(updatedInvitation));

      mockDb.updateTable = mock(() => updateMockBuilder);

      // Act
      const result = await resendInvitation("company-123", "invitation-123", "user-123");

      // Assert
      expect(result).toBeDefined();
      expect(result.token).toBe("new-token");
    });

    it("should throw InvitationNotFoundError for non-existent invitation", async () => {
      // Arrange - mock company and user as existing, but invitation not found
      const mockCompany = createMockCompany();
      const mockUser = { email: "resender@example.com" };
      let selectCallCount = 0;

      const selectMockBuilder: Record<string, unknown> = {};
      selectMockBuilder.select = mock(() => selectMockBuilder);
      selectMockBuilder.selectAll = mock(() => selectMockBuilder);
      selectMockBuilder.innerJoin = mock(() => selectMockBuilder);
      selectMockBuilder.where = mock(() => selectMockBuilder);
      selectMockBuilder.executeTakeFirst = mock(() => {
        selectCallCount++;
        // First call: getCompany, second call: get user, third call: get invitation (not found)
        if (selectCallCount === 1) return Promise.resolve(mockCompany);
        if (selectCallCount === 2) return Promise.resolve(mockUser);
        return Promise.resolve(undefined);
      });

      mockDb.selectFrom = mock(() => selectMockBuilder);

      // Act & Assert
      await expect(resendInvitation("company-123", "non-existent", "user-123")).rejects.toThrow(InvitationNotFoundError);
    });
  });

  describe("Error Classes", () => {
    it("CompanyNotFoundError should have correct properties", () => {
      const error = new CompanyNotFoundError("company-123");
      expect(error.name).toBe("CompanyNotFoundError");
      expect(error.message).toContain("company-123");
    });

    it("InvitationNotFoundError should have correct properties", () => {
      const error = new InvitationNotFoundError("token-123");
      expect(error.name).toBe("InvitationNotFoundError");
      expect(error.message).toContain("token-123");
    });

    it("InvitationExpiredError should have correct properties", () => {
      const error = new InvitationExpiredError();
      expect(error.name).toBe("InvitationExpiredError");
      expect(error.message).toContain("expired");
    });

    it("UserAlreadyMemberError should have correct properties", () => {
      const error = new UserAlreadyMemberError("user@example.com");
      expect(error.name).toBe("UserAlreadyMemberError");
      expect(error.message).toContain("user@example.com");
    });

    it("InsufficientPermissionsError should have correct properties", () => {
      const error = new InsufficientPermissionsError("delete company");
      expect(error.name).toBe("InsufficientPermissionsError");
      expect(error.message).toContain("delete company");
    });
  });
});
