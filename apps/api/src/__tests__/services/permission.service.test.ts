/**
 * Unit tests for permission.service.ts
 *
 * Tests feature-based permissions including:
 * - Role-based default permissions
 * - Effective permission calculation
 * - Permission checking functions
 */

import { describe, it, expect, mock, beforeEach } from "bun:test"
import {
  createMockCompanyMember,
  createMutableMockQueryBuilder,
  resetMockQueryBuilder,
} from "../mocks"

// Mock query builder - using centralized mock utilities
let mockQueryBuilder = createMutableMockQueryBuilder()

// Mock database
const mockDb = {
  selectFrom: mock(() => mockQueryBuilder),
  updateTable: mock(() => mockQueryBuilder),
}

mock.module("@whatsapp-web/database", () => ({
  db: mockDb,
}))

// Import the service after mocking
import {
  PERMISSIONS,
  ROLE_PRESETS,
  getEffectivePermissions,
  getMemberWithPermissions,
  hasFeaturePermission,
  hasAllPermissions,
  hasAnyPermission,
  updateMemberPermissions,
  resetMemberPermissions,
  getPermissionDescriptions,
  type MemberPermissions,
} from "../../services/permission.service.js"

describe("Permission Service", () => {
  beforeEach(() => {
    resetMockQueryBuilder(mockQueryBuilder)
  })

  describe("PERMISSIONS constant", () => {
    it("should have all required permission keys", () => {
      expect(PERMISSIONS.CAN_VIEW_ALL_CHATS).toBe("can_view_all_chats")
      expect(PERMISSIONS.CAN_SEND_MESSAGES).toBe("can_send_messages")
      expect(PERMISSIONS.CAN_ASSIGN_CONTACTS).toBe("can_assign_contacts")
      expect(PERMISSIONS.CAN_MANAGE_TEAM).toBe("can_manage_team")
      expect(PERMISSIONS.CAN_INVITE).toBe("can_invite")
      expect(PERMISSIONS.CAN_EXPORT).toBe("can_export")
      expect(PERMISSIONS.CAN_DELETE).toBe("can_delete")
    })
  })

  describe("ROLE_PRESETS", () => {
    it("should give owner all permissions", () => {
      const ownerPermissions = ROLE_PRESETS.owner
      expect(ownerPermissions.can_view_all_chats).toBe(true)
      expect(ownerPermissions.can_send_messages).toBe(true)
      expect(ownerPermissions.can_assign_contacts).toBe(true)
      expect(ownerPermissions.can_manage_team).toBe(true)
      expect(ownerPermissions.can_invite).toBe(true)
      expect(ownerPermissions.can_export).toBe(true)
      expect(ownerPermissions.can_delete).toBe(true)
    })

    it("should give admin most permissions except manage_team", () => {
      const adminPermissions = ROLE_PRESETS.admin
      expect(adminPermissions.can_view_all_chats).toBe(true)
      expect(adminPermissions.can_send_messages).toBe(true)
      expect(adminPermissions.can_assign_contacts).toBe(true)
      expect(adminPermissions.can_manage_team).toBe(false) // Key difference
      expect(adminPermissions.can_invite).toBe(true)
      expect(adminPermissions.can_export).toBe(true)
      expect(adminPermissions.can_delete).toBe(true)
    })

    it("should give member only basic permissions", () => {
      const memberPermissions = ROLE_PRESETS.member
      expect(memberPermissions.can_view_all_chats).toBe(false)
      expect(memberPermissions.can_send_messages).toBe(true) // Can send messages
      expect(memberPermissions.can_assign_contacts).toBe(false)
      expect(memberPermissions.can_manage_team).toBe(false)
      expect(memberPermissions.can_invite).toBe(false)
      expect(memberPermissions.can_export).toBe(false)
      expect(memberPermissions.can_delete).toBe(false)
    })
  })

  describe("getEffectivePermissions", () => {
    it("should return role defaults when no custom permissions", () => {
      const permissions = getEffectivePermissions("admin", {})
      expect(permissions).toEqual(ROLE_PRESETS.admin)
    })

    it("should merge custom permissions with role defaults", () => {
      const customPermissions: Partial<MemberPermissions> = {
        can_view_all_chats: false, // Override default
        can_export: false, // Override default
      }
      const permissions = getEffectivePermissions("admin", customPermissions)

      expect(permissions.can_view_all_chats).toBe(false)
      expect(permissions.can_export).toBe(false)
      expect(permissions.can_send_messages).toBe(true) // Unchanged from role default
    })

    it("should ignore custom permissions for owner role", () => {
      const customPermissions: Partial<MemberPermissions> = {
        can_view_all_chats: false,
        can_manage_team: false,
      }
      const permissions = getEffectivePermissions("owner", customPermissions)

      // Owner always has all permissions
      expect(permissions.can_view_all_chats).toBe(true)
      expect(permissions.can_manage_team).toBe(true)
    })

    it("should allow upgrading member permissions via custom", () => {
      const customPermissions: Partial<MemberPermissions> = {
        can_export: true, // Upgrade from default false
        can_assign_contacts: true,
      }
      const permissions = getEffectivePermissions("member", customPermissions)

      expect(permissions.can_export).toBe(true)
      expect(permissions.can_assign_contacts).toBe(true)
      expect(permissions.can_manage_team).toBe(false) // Not upgraded
    })
  })

  describe("getMemberWithPermissions", () => {
    it("should return null if member not found", async () => {
      resetMockQueryBuilder(mockQueryBuilder, undefined)
      mockDb.selectFrom = mock(() => mockQueryBuilder)

      const result = await getMemberWithPermissions("company-1", "user-1")
      expect(result).toBeNull()
    })

    it("should return role and effective permissions for member", async () => {
      const mockMember = {
        role: "admin",
        permissions: { can_export: false },
      }
      resetMockQueryBuilder(mockQueryBuilder, mockMember)
      mockDb.selectFrom = mock(() => mockQueryBuilder)

      const result = await getMemberWithPermissions("company-1", "user-1")

      expect(result).not.toBeNull()
      expect(result!.role).toBe("admin")
      expect(result!.permissions.can_export).toBe(false)
      expect(result!.permissions.can_send_messages).toBe(true) // Default
    })
  })

  describe("hasFeaturePermission", () => {
    it("should return false if member not found", async () => {
      resetMockQueryBuilder(mockQueryBuilder, undefined)
      mockDb.selectFrom = mock(() => mockQueryBuilder)

      const result = await hasFeaturePermission(
        "company-1",
        "user-1",
        PERMISSIONS.CAN_EXPORT
      )
      expect(result).toBe(false)
    })

    it("should return true if member has permission", async () => {
      const mockMember = { role: "admin", permissions: {} }
      resetMockQueryBuilder(mockQueryBuilder, mockMember)
      mockDb.selectFrom = mock(() => mockQueryBuilder)

      const result = await hasFeaturePermission(
        "company-1",
        "user-1",
        PERMISSIONS.CAN_EXPORT
      )
      expect(result).toBe(true)
    })

    it("should return false if member lacks permission", async () => {
      const mockMember = { role: "member", permissions: {} }
      resetMockQueryBuilder(mockQueryBuilder, mockMember)
      mockDb.selectFrom = mock(() => mockQueryBuilder)

      const result = await hasFeaturePermission(
        "company-1",
        "user-1",
        PERMISSIONS.CAN_EXPORT
      )
      expect(result).toBe(false)
    })
  })

  describe("hasAllPermissions", () => {
    it("should return true if member has all requested permissions", async () => {
      const mockMember = { role: "admin", permissions: {} }
      resetMockQueryBuilder(mockQueryBuilder, mockMember)
      mockDb.selectFrom = mock(() => mockQueryBuilder)

      const result = await hasAllPermissions("company-1", "user-1", [
        PERMISSIONS.CAN_SEND_MESSAGES,
        PERMISSIONS.CAN_EXPORT,
      ])
      expect(result).toBe(true)
    })

    it("should return false if member lacks any requested permission", async () => {
      const mockMember = { role: "member", permissions: {} }
      resetMockQueryBuilder(mockQueryBuilder, mockMember)
      mockDb.selectFrom = mock(() => mockQueryBuilder)

      const result = await hasAllPermissions("company-1", "user-1", [
        PERMISSIONS.CAN_SEND_MESSAGES,
        PERMISSIONS.CAN_EXPORT, // Member doesn't have this
      ])
      expect(result).toBe(false)
    })
  })

  describe("hasAnyPermission", () => {
    it("should return true if member has any of the requested permissions", async () => {
      const mockMember = { role: "member", permissions: {} }
      resetMockQueryBuilder(mockQueryBuilder, mockMember)
      mockDb.selectFrom = mock(() => mockQueryBuilder)

      const result = await hasAnyPermission("company-1", "user-1", [
        PERMISSIONS.CAN_SEND_MESSAGES, // Member has this
        PERMISSIONS.CAN_EXPORT, // Member doesn't have this
      ])
      expect(result).toBe(true)
    })

    it("should return false if member has none of the requested permissions", async () => {
      const mockMember = { role: "member", permissions: {} }
      resetMockQueryBuilder(mockQueryBuilder, mockMember)
      mockDb.selectFrom = mock(() => mockQueryBuilder)

      const result = await hasAnyPermission("company-1", "user-1", [
        PERMISSIONS.CAN_EXPORT,
        PERMISSIONS.CAN_MANAGE_TEAM,
      ])
      expect(result).toBe(false)
    })
  })

  describe("updateMemberPermissions", () => {
    it("should throw error if member not found", async () => {
      resetMockQueryBuilder(mockQueryBuilder, undefined)
      mockDb.selectFrom = mock(() => mockQueryBuilder)

      await expect(
        updateMemberPermissions("company-1", "user-1", { can_export: true })
      ).rejects.toThrow("Member not found")
    })

    it("should throw error when trying to modify owner permissions", async () => {
      const mockMember = { role: "owner", permissions: {} }
      resetMockQueryBuilder(mockQueryBuilder, mockMember)
      mockDb.selectFrom = mock(() => mockQueryBuilder)

      await expect(
        updateMemberPermissions("company-1", "user-1", { can_export: false })
      ).rejects.toThrow("Cannot modify owner's permissions")
    })

    it("should update and return effective permissions", async () => {
      const mockMember = { role: "admin", permissions: { can_view_all_chats: true } }
      resetMockQueryBuilder(mockQueryBuilder, mockMember)
      mockDb.selectFrom = mock(() => mockQueryBuilder)
      mockDb.updateTable = mock(() => ({
        set: mock(() => ({
          where: mock(() => ({
            where: mock(() => ({
              execute: mock(() => Promise.resolve()),
            })),
          })),
        })),
      }))

      const result = await updateMemberPermissions("company-1", "user-1", {
        can_export: false,
      })

      expect(result.can_export).toBe(false)
      expect(result.can_view_all_chats).toBe(true) // Merged from existing
    })
  })

  describe("resetMemberPermissions", () => {
    it("should throw error if member not found", async () => {
      resetMockQueryBuilder(mockQueryBuilder, undefined)
      mockDb.selectFrom = mock(() => mockQueryBuilder)

      await expect(
        resetMemberPermissions("company-1", "user-1")
      ).rejects.toThrow("Member not found")
    })

    it("should reset permissions to role defaults", async () => {
      const mockMember = { role: "admin" }
      resetMockQueryBuilder(mockQueryBuilder, mockMember)
      mockDb.selectFrom = mock(() => mockQueryBuilder)
      mockDb.updateTable = mock(() => ({
        set: mock(() => ({
          where: mock(() => ({
            where: mock(() => ({
              execute: mock(() => Promise.resolve()),
            })),
          })),
        })),
      }))

      const result = await resetMemberPermissions("company-1", "user-1")

      expect(result).toEqual(ROLE_PRESETS.admin)
    })
  })

  describe("getPermissionDescriptions", () => {
    it("should return all permission descriptions", () => {
      const descriptions = getPermissionDescriptions()

      expect(descriptions.length).toBe(7)
      expect(descriptions.map((d) => d.key)).toContain(
        PERMISSIONS.CAN_VIEW_ALL_CHATS
      )
      expect(descriptions.map((d) => d.key)).toContain(
        PERMISSIONS.CAN_SEND_MESSAGES
      )
    })

    it("should have name, description, and category for each permission", () => {
      const descriptions = getPermissionDescriptions()

      for (const desc of descriptions) {
        expect(desc.key).toBeDefined()
        expect(desc.name).toBeDefined()
        expect(desc.description).toBeDefined()
        expect(desc.category).toBeDefined()
        expect(desc.name.length).toBeGreaterThan(0)
        expect(desc.description.length).toBeGreaterThan(0)
      }
    })
  })
})
