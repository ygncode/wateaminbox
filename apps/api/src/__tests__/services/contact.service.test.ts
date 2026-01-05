/**
 * Unit tests for contact.service.ts
 *
 * Tests contact service functionality including:
 * - getContactsWithLastMessage() - optimized query with window functions
 * - assignContactToUser()
 * - getCurrentAssignment()
 * - unassignContact()
 * - ensureContactAssignment()
 */

import { describe, it, expect, mock, beforeEach } from "bun:test";

// Query execution counter to track number of queries
let queryCount = 0;
let mockSqlExecutor: ((db: unknown) => Promise<{ rows: unknown[] }>) | null = null;

function resetQueryCount() {
  queryCount = 0;
}

function getQueryCount() {
  return queryCount;
}

// Helper to create a complete mock Kysely query builder
function createMockKyselyQueryBuilder(totalCount: number) {
  const builder = {
    selectFrom: mock(() => builder),
    select: mock(() => builder),
    leftJoin: mock(() => builder),
    where: mock(() => builder),
    or: mock(() => true),
    execute: mock(() => Promise.resolve([])),
    executeTakeFirst: mock(() => {
      queryCount++;
      return Promise.resolve({ total: totalCount });
    }),
  };
  return builder;
}

// Mock kysely module before importing the service
mock.module("kysely", () => ({
  sql: Object.assign(
    mock((_: TemplateStringsArray, ...__: unknown[]) => ({
      execute: (db: unknown) => {
        queryCount++;
        return mockSqlExecutor
          ? mockSqlExecutor(db)
          : Promise.resolve({ rows: [] });
      },
    })),
    {
      raw: (fragments: string[]) => ({
        execute: (db: unknown) => {
          queryCount++;
          return mockSqlExecutor
            ? mockSqlExecutor(db)
            : Promise.resolve({ rows: [] });
        },
      }),
    },
  ),
  Kysely: class MockKysely {},
}));

// Now we can import the service
import {
  getContactsWithLastMessage,
  assignContactToUser,
  getCurrentAssignment,
  unassignContact,
  ensureContactAssignment,
} from "../../services/contact.service";

describe("ContactService", () => {
  beforeEach(() => {
    resetQueryCount();
  });

  describe("getContactsWithLastMessage", () => {
    it("should return contacts with last message data", async () => {
      // Arrange
      const timestamp = new Date("2024-01-15T10:30:00Z");
      const mockContacts = [
        {
          id: "contact-1",
          jid: "1234567890@s.whatsapp.net",
          phone_number: "1234567890",
          push_name: "John Doe",
          custom_name: null,
          is_group: false,
          profile_picture_url: null,
          notes_shared: null,
          created_at: new Date(),
          updated_at: new Date(),
          assigned_to: null,
          last_message_at: timestamp,
          last_message_id: "msg-1",
          last_message_message_id: "wa-msg-1",
          last_message_from_me: false,
          last_message_message_type: "text",
          last_message_content: "Hello there!",
          last_message_status: "read",
          last_message_timestamp: timestamp,
          unread_count: "2",
        },
      ];

      mockSqlExecutor = () => Promise.resolve({ rows: mockContacts });

      const mockTenantDb = {
        selectFrom: mock(() => createMockKyselyQueryBuilder(1)),
      };

      // Act
      const result = await getContactsWithLastMessage(
        mockTenantDb as Parameters<typeof getContactsWithLastMessage>[0],
        {},
      );

      // Assert
      expect(result.contacts).toHaveLength(1);
      expect(result.contacts[0].id).toBe("contact-1");
      expect(result.contacts[0].push_name).toBe("John Doe");
      expect(result.contacts[0].last_message).not.toBeNull();
      expect(result.contacts[0].last_message?.content).toBe("Hello there!");
      expect(result.contacts[0].last_message?.fromMe).toBe(false);
      expect(result.total).toBe(1);
    });

    it("should handle contacts with no messages (lastMessage: null)", async () => {
      // Arrange
      const mockContacts = [
        {
          id: "contact-2",
          jid: "9876543210@s.whatsapp.net",
          phone_number: "9876543210",
          push_name: "Jane Smith",
          custom_name: null,
          is_group: false,
          profile_picture_url: null,
          notes_shared: null,
          created_at: new Date(),
          updated_at: new Date(),
          assigned_to: null,
          last_message_at: null,
          last_message_id: null,
          last_message_message_id: null,
          last_message_from_me: null,
          last_message_message_type: null,
          last_message_content: null,
          last_message_status: null,
          last_message_timestamp: null,
          unread_count: "0",
        },
      ];

      mockSqlExecutor = () => Promise.resolve({ rows: mockContacts });

      const mockTenantDb = {
        selectFrom: mock(() => createMockKyselyQueryBuilder(1)),
      };

      // Act
      const result = await getContactsWithLastMessage(
        mockTenantDb as Parameters<typeof getContactsWithLastMessage>[0],
        {},
      );

      // Assert
      expect(result.contacts).toHaveLength(1);
      expect(result.contacts[0].id).toBe("contact-2");
      expect(result.contacts[0].last_message).toBeNull();
      expect(result.contacts[0].last_message_at).toBeNull();
      expect(result.contacts[0].unread_count).toBe(BigInt(0));
    });

    it("should execute only 2 queries (main query + count query)", async () => {
      // Arrange
      const mockContacts = [
        {
          id: "contact-1",
          jid: "1234567890@s.whatsapp.net",
          phone_number: "1234567890",
          push_name: "Contact 1",
          custom_name: null,
          is_group: false,
          profile_picture_url: null,
          notes_shared: null,
          created_at: new Date(),
          updated_at: new Date(),
          assigned_to: null,
          last_message_at: new Date(),
          last_message_id: "msg-1",
          last_message_message_id: "wa-msg-1",
          last_message_from_me: false,
          last_message_message_type: "text",
          last_message_content: "Message 1",
          last_message_status: "read",
          last_message_timestamp: new Date(),
          unread_count: "1",
        },
        {
          id: "contact-2",
          jid: "9876543210@s.whatsapp.net",
          phone_number: "9876543210",
          push_name: "Contact 2",
          custom_name: null,
          is_group: false,
          profile_picture_url: null,
          notes_shared: null,
          created_at: new Date(),
          updated_at: new Date(),
          assigned_to: null,
          last_message_at: new Date(),
          last_message_id: "msg-2",
          last_message_message_id: "wa-msg-2",
          last_message_from_me: true,
          last_message_message_type: "text",
          last_message_content: "Message 2",
          last_message_status: "sent",
          last_message_timestamp: new Date(),
          unread_count: "0",
        },
      ];

      mockSqlExecutor = () => Promise.resolve({ rows: mockContacts });

      const mockTenantDb = {
        selectFrom: mock(() => createMockKyselyQueryBuilder(2)),
      };

      // Act
      await getContactsWithLastMessage(
        mockTenantDb as Parameters<typeof getContactsWithLastMessage>[0],
        {},
      );

      // Assert
      // Should be exactly 2 queries: 1 for contacts with last messages, 1 for count
      expect(getQueryCount()).toBe(2);
    });

    it("should handle search filter correctly", async () => {
      // Arrange
      const mockContacts = [
        {
          id: "contact-1",
          jid: "1234567890@s.whatsapp.net",
          phone_number: "1234567890",
          push_name: "John Doe",
          custom_name: null,
          is_group: false,
          profile_picture_url: null,
          notes_shared: null,
          created_at: new Date(),
          updated_at: new Date(),
          assigned_to: null,
          last_message_at: new Date(),
          last_message_id: "msg-1",
          last_message_message_id: "wa-msg-1",
          last_message_from_me: false,
          last_message_message_type: "text",
          last_message_content: "Hello",
          last_message_status: "read",
          last_message_timestamp: new Date(),
          unread_count: "0",
        },
      ];

      mockSqlExecutor = () => Promise.resolve({ rows: mockContacts });

      const mockTenantDb = {
        selectFrom: mock(() => createMockKyselyQueryBuilder(1)),
      };

      // Act
      const result = await getContactsWithLastMessage(
        mockTenantDb as Parameters<typeof getContactsWithLastMessage>[0],
        { search: "John" },
      );

      // Assert
      expect(result.contacts).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it("should handle includeGroups filter correctly", async () => {
      // Arrange
      const mockContacts = [
        {
          id: "contact-1",
          jid: "1234567890@s.whatsapp.net",
          phone_number: "1234567890",
          push_name: "John Doe",
          custom_name: null,
          is_group: false,
          profile_picture_url: null,
          notes_shared: null,
          created_at: new Date(),
          updated_at: new Date(),
          assigned_to: null,
          last_message_at: new Date(),
          last_message_id: "msg-1",
          last_message_message_id: "wa-msg-1",
          last_message_from_me: false,
          last_message_message_type: "text",
          last_message_content: "Hello",
          last_message_status: "read",
          last_message_timestamp: new Date(),
          unread_count: "0",
        },
      ];

      mockSqlExecutor = () => Promise.resolve({ rows: mockContacts });

      const mockTenantDb = {
        selectFrom: mock(() => createMockKyselyQueryBuilder(1)),
      };

      // Act - when includeGroups is true, no WHERE c.is_group = false should be added
      const result = await getContactsWithLastMessage(
        mockTenantDb as Parameters<typeof getContactsWithLastMessage>[0],
        { includeGroups: true },
      );

      // Assert - query was executed
      expect(result.contacts).toHaveLength(1);
      expect(getQueryCount()).toBe(2);
    });

    it("should handle assignedToMe filter correctly", async () => {
      // Arrange
      const userId = "user-123";
      const mockContacts = [
        {
          id: "contact-1",
          jid: "1234567890@s.whatsapp.net",
          phone_number: "1234567890",
          push_name: "John Doe",
          custom_name: null,
          is_group: false,
          profile_picture_url: null,
          notes_shared: null,
          created_at: new Date(),
          updated_at: new Date(),
          assigned_to: userId,
          last_message_at: new Date(),
          last_message_id: "msg-1",
          last_message_message_id: "wa-msg-1",
          last_message_from_me: false,
          last_message_message_type: "text",
          last_message_content: "Hello",
          last_message_status: "read",
          last_message_timestamp: new Date(),
          unread_count: "0",
        },
      ];

      mockSqlExecutor = () => Promise.resolve({ rows: mockContacts });

      const mockTenantDb = {
        selectFrom: mock(() => createMockKyselyQueryBuilder(1)),
      };

      // Act
      const result = await getContactsWithLastMessage(
        mockTenantDb as Parameters<typeof getContactsWithLastMessage>[0],
        { assignedToMe: true, userId },
      );

      // Assert
      expect(result.contacts).toHaveLength(1);
      expect(result.contacts[0].assigned_to).toBe(userId);
    });

    it("should handle unassigned filter correctly", async () => {
      // Arrange
      const mockContacts = [
        {
          id: "contact-1",
          jid: "1234567890@s.whatsapp.net",
          phone_number: "1234567890",
          push_name: "John Doe",
          custom_name: null,
          is_group: false,
          profile_picture_url: null,
          notes_shared: null,
          created_at: new Date(),
          updated_at: new Date(),
          assigned_to: null,
          last_message_at: new Date(),
          last_message_id: "msg-1",
          last_message_message_id: "wa-msg-1",
          last_message_from_me: false,
          last_message_message_type: "text",
          last_message_content: "Hello",
          last_message_status: "read",
          last_message_timestamp: new Date(),
          unread_count: "0",
        },
      ];

      mockSqlExecutor = () => Promise.resolve({ rows: mockContacts });

      const mockTenantDb = {
        selectFrom: mock(() => createMockKyselyQueryBuilder(1)),
      };

      // Act
      const result = await getContactsWithLastMessage(
        mockTenantDb as Parameters<typeof getContactsWithLastMessage>[0],
        { unassigned: true },
      );

      // Assert
      expect(result.contacts).toHaveLength(1);
      expect(result.contacts[0].assigned_to).toBeNull();
    });

    it("should handle limit and offset correctly", async () => {
      // Arrange
      const mockContacts = [
        {
          id: "contact-1",
          jid: "1234567890@s.whatsapp.net",
          phone_number: "1234567890",
          push_name: "John Doe",
          custom_name: null,
          is_group: false,
          profile_picture_url: null,
          notes_shared: null,
          created_at: new Date(),
          updated_at: new Date(),
          assigned_to: null,
          last_message_at: new Date(),
          last_message_id: "msg-1",
          last_message_message_id: "wa-msg-1",
          last_message_from_me: false,
          last_message_message_type: "text",
          last_message_content: "Hello",
          last_message_status: "read",
          last_message_timestamp: new Date(),
          unread_count: "0",
        },
      ];

      mockSqlExecutor = () => Promise.resolve({ rows: mockContacts });

      const mockTenantDb = {
        selectFrom: mock(() => createMockKyselyQueryBuilder(100)),
      };

      // Act
      const result = await getContactsWithLastMessage(
        mockTenantDb as Parameters<typeof getContactsWithLastMessage>[0],
        { limit: 20, offset: 40 },
      );

      // Assert
      expect(result.total).toBe(100);
    });

    it("should handle unread_count as BigInt", async () => {
      // Arrange
      const mockContacts = [
        {
          id: "contact-1",
          jid: "1234567890@s.whatsapp.net",
          phone_number: "1234567890",
          push_name: "John Doe",
          custom_name: null,
          is_group: false,
          profile_picture_url: null,
          notes_shared: null,
          created_at: new Date(),
          updated_at: new Date(),
          assigned_to: null,
          last_message_at: new Date(),
          last_message_id: "msg-1",
          last_message_message_id: "wa-msg-1",
          last_message_from_me: false,
          last_message_message_type: "text",
          last_message_content: "Hello",
          last_message_status: "read",
          last_message_timestamp: new Date(),
          unread_count: "5", // String from PostgreSQL that should be converted to BigInt
        },
      ];

      mockSqlExecutor = () => Promise.resolve({ rows: mockContacts });

      const mockTenantDb = {
        selectFrom: mock(() => createMockKyselyQueryBuilder(1)),
      };

      // Act
      const result = await getContactsWithLastMessage(
        mockTenantDb as Parameters<typeof getContactsWithLastMessage>[0],
        {},
      );

      // Assert
      expect(result.contacts[0].unread_count).toBe(BigInt(5));
      expect(typeof result.contacts[0].unread_count).toBe("bigint");
    });

    it("should return contacts with different last message types", async () => {
      // Arrange
      const mockContacts = [
        {
          id: "contact-1",
          jid: "1234567890@s.whatsapp.net",
          phone_number: "1234567890",
          push_name: "John Doe",
          custom_name: null,
          is_group: false,
          profile_picture_url: null,
          notes_shared: null,
          created_at: new Date(),
          updated_at: new Date(),
          assigned_to: null,
          last_message_at: new Date(),
          last_message_id: "msg-1",
          last_message_message_id: "wa-msg-1",
          last_message_from_me: false,
          last_message_message_type: "image",
          last_message_content: null,
          last_message_status: "delivered",
          last_message_timestamp: new Date(),
          unread_count: "1",
        },
      ];

      mockSqlExecutor = () => Promise.resolve({ rows: mockContacts });

      const mockTenantDb = {
        selectFrom: mock(() => createMockKyselyQueryBuilder(1)),
      };

      // Act
      const result = await getContactsWithLastMessage(
        mockTenantDb as Parameters<typeof getContactsWithLastMessage>[0],
        {},
      );

      // Assert
      expect(result.contacts[0].last_message?.messageType).toBe("image");
      expect(result.contacts[0].last_message?.content).toBeNull();
    });

    it("should handle multiple filter combinations", async () => {
      // Arrange
      const userId = "user-123";
      const mockContacts: unknown[] = [];

      mockSqlExecutor = () => Promise.resolve({ rows: mockContacts });

      const mockTenantDb = {
        selectFrom: mock(() => createMockKyselyQueryBuilder(0)),
      };

      // Act - search + assignedToMe + excludeGroups
      const result = await getContactsWithLastMessage(
        mockTenantDb as Parameters<typeof getContactsWithLastMessage>[0],
        {
          search: "John",
          assignedToMe: true,
          userId,
          includeGroups: false,
          limit: 10,
        },
      );

      // Assert
      expect(result.contacts).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(getQueryCount()).toBe(2);
    });
  });

  describe("assignContactToUser", () => {
    it("should assign contact to user successfully", async () => {
      // Arrange
      const contactId = "contact-123";
      const userId = "user-456";
      const assignedBy = "user-789";

      let updateCalled = false;
      let insertValues: unknown = null;

      const mockDb = {
        updateTable: mock(() => ({
          set: mock(() => ({
            where: mock(() => ({
              where: mock(() => ({
                execute: mock(() => {
                  updateCalled = true;
                  return Promise.resolve([]);
                }),
              })),
            })),
          })),
        })),
        insertInto: mock(() => ({
          values: mock((values: unknown) => {
            insertValues = values;
            return {
              returning: mock(() => ({
                executeTakeFirstOrThrow: mock(() =>
                  Promise.resolve({
                    id: "assignment-123",
                    assigned_to: userId,
                    assigned_by: assignedBy,
                    assigned_at: new Date(),
                  }),
                ),
              })),
            };
          }),
        })),
      };

      // Act
      const result = await assignContactToUser(
        mockDb as Parameters<typeof assignContactToUser>[0],
        contactId,
        userId,
        assignedBy,
      );

      // Assert
      expect(updateCalled).toBe(true);
      expect(result.id).toBe("assignment-123");
      expect(result.assignedTo).toBe(userId);
      expect(result.assignedBy).toBe(assignedBy);
      expect(result.assignedAt).toBeInstanceOf(Date);
    });

    it("should unassign previous assignment before creating new one", async () => {
      // Arrange
      const contactId = "contact-123";
      const userId = "user-456";
      const assignedBy = "user-789";

      let executeCalled = false;
      let insertValues: unknown = null;

      const mockDb = {
        updateTable: mock(() => ({
          set: mock(() => ({
            where: mock(() => ({
              where: mock(() => ({
                execute: mock(() => {
                  executeCalled = true;
                  return Promise.resolve([]);
                }),
              })),
            })),
          })),
        })),
        insertInto: mock(() => ({
          values: mock((values: unknown) => {
            insertValues = values;
            return {
              returning: mock(() => ({
                executeTakeFirstOrThrow: mock(() =>
                  Promise.resolve({
                    id: "assignment-123",
                    assigned_to: userId,
                    assigned_by: assignedBy,
                    assigned_at: new Date(),
                  }),
                ),
              })),
            };
          }),
        })),
      };

      // Act
      await assignContactToUser(
        mockDb as Parameters<typeof assignContactToUser>[0],
        contactId,
        userId,
        assignedBy,
      );

      // Assert
      expect(executeCalled).toBe(true); // Update execute was called
      expect(insertValues).toEqual(
        expect.objectContaining({
          contact_id: contactId,
          assigned_to: userId,
          assigned_by: assignedBy,
        }),
      );
    });
  });

  describe("getCurrentAssignment", () => {
    it("should return current assignment for contact", async () => {
      // Arrange
      const mockAssignment = {
        id: "assignment-123",
        assigned_to: "user-456",
        assigned_by: "user-789",
        assigned_at: new Date(),
      };

      const mockDb = {
        selectFrom: mock(() => ({
          select: mock(() => ({
            where: mock(() => ({
              where: mock(() => ({
                executeTakeFirst: mock(() => Promise.resolve(mockAssignment)),
              })),
            })),
          })),
        })),
      };

      // Act
      const result = await getCurrentAssignment(
        mockDb as Parameters<typeof getCurrentAssignment>[0],
        "contact-123",
      );

      // Assert
      expect(result).toEqual(mockAssignment);
    });

    it("should return null if no active assignment", async () => {
      // Arrange
      const mockDb = {
        selectFrom: mock(() => ({
          select: mock(() => ({
            where: mock(() => ({
              where: mock(() => ({
                executeTakeFirst: mock(() => Promise.resolve(null)),
              })),
            })),
          })),
        })),
      };

      // Act
      const result = await getCurrentAssignment(
        mockDb as Parameters<typeof getCurrentAssignment>[0],
        "contact-123",
      );

      // Assert
      expect(result).toBeNull();
    });
  });

  describe("unassignContact", () => {
    it("should unassign contact successfully", async () => {
      // Arrange
      let updateCalled = false;
      let unassignedAtSet: Date | null = null;

      const mockDb = {
        updateTable: mock(() => ({
          set: mock((values: unknown) => {
            unassignedAtSet = (values as { unassigned_at: Date }).unassigned_at;
            return {
              where: mock(() => ({
                where: mock(() => ({
                  execute: mock(() => {
                    updateCalled = true;
                    return Promise.resolve([]);
                  }),
                })),
              })),
            };
          }),
        })),
      };

      // Act
      await unassignContact(
        mockDb as Parameters<typeof unassignContact>[0],
        "contact-123",
      );

      // Assert
      expect(updateCalled).toBe(true);
      expect(unassignedAtSet).toBeInstanceOf(Date);
    });
  });

  describe("ensureContactAssignment", () => {
    it("should create assignment if none exists", async () => {
      // Arrange
      const contactId = "contact-123";
      const userId = "user-456";
      const assignedBy = "user-789";

      const mockDb = {
        selectFrom: mock(() => ({
          select: mock(() => ({
            where: mock(() => ({
              where: mock(() => ({
                executeTakeFirst: mock(() => Promise.resolve(null)),
              })),
            })),
          })),
        })),
        updateTable: mock(() => ({
          set: mock(() => ({
            where: mock(() => ({
              where: mock(() => ({
                execute: mock(() => Promise.resolve([])),
              })),
            })),
          })),
        })),
        insertInto: mock(() => ({
          values: mock(() => ({
            returning: mock(() => ({
              executeTakeFirstOrThrow: mock(() =>
                Promise.resolve({
                  id: "assignment-123",
                  assigned_to: userId,
                  assigned_by: assignedBy,
                  assigned_at: new Date(),
                }),
              ),
            })),
          })),
        })),
      };

      // Act
      const result = await ensureContactAssignment(
        mockDb as Parameters<typeof ensureContactAssignment>[0],
        contactId,
        userId,
      );

      // Assert
      expect(result).toBe(true); // Should return true when new assignment is created
    });

    it("should not create assignment if one exists", async () => {
      // Arrange
      const contactId = "contact-123";
      const userId = "user-456";

      const mockAssignment = {
        id: "assignment-existing",
        assigned_to: userId,
        assigned_by: "user-789",
        assigned_at: new Date(),
      };

      const mockDb = {
        selectFrom: mock(() => ({
          select: mock(() => ({
            where: mock(() => ({
              where: mock(() => ({
                executeTakeFirst: mock(() => Promise.resolve(mockAssignment)),
              })),
            })),
          })),
        })),
      };

      // Act
      const result = await ensureContactAssignment(
        mockDb as Parameters<typeof ensureContactAssignment>[0],
        contactId,
        userId,
      );

      // Assert
      expect(result).toBe(false); // Should return false when assignment already exists
    });
  });
});
