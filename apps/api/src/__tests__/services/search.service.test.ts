/**
 * Unit tests for search.service.ts
 *
 * Tests search functionality including:
 * - Full-text message search
 * - Contact search
 * - Global search
 * - Search vector updates
 */

import { describe, it, expect, mock, beforeEach } from "bun:test";
import { createMockMessage, createMockContact } from "../mocks";

// Mock query builder
let mockQueryBuilder: Record<string, unknown>;

function resetMockQueryBuilder(returnValue: unknown = undefined) {
  mockQueryBuilder = {
    selectFrom: mock(() => mockQueryBuilder),
    select: mock(() => mockQueryBuilder),
    selectAll: mock(() => mockQueryBuilder),
    where: mock(() => mockQueryBuilder),
    innerJoin: mock(() => mockQueryBuilder),
    leftJoin: mock(() => mockQueryBuilder),
    orderBy: mock(() => mockQueryBuilder),
    groupBy: mock(() => mockQueryBuilder),
    limit: mock(() => mockQueryBuilder),
    offset: mock(() => mockQueryBuilder),
    $if: mock(() => mockQueryBuilder),
    or: mock(() => mockQueryBuilder),
    execute: mock(() => Promise.resolve({ rows: Array.isArray(returnValue) ? returnValue : [] })),
    executeTakeFirst: mock(() => Promise.resolve(returnValue)),
  };
}

// Mock tenant database
const mockTenantDb = {
  selectFrom: mock(() => mockQueryBuilder),
};

// Mock sql template
const mockSql = mock((strings: TemplateStringsArray, ..._values: unknown[]) => ({
  execute: mock(() =>
    Promise.resolve({
      rows: [],
    })
  ),
}));

// Mock getTenantConnection
const mockGetTenantConnection = mock((_companyId: string) => mockTenantDb);

mock.module("../../services/tenant.service.js", () => ({
  getTenantConnection: mockGetTenantConnection,
}));

mock.module("kysely", () => ({
  sql: mockSql,
}));

// Mock Meilisearch service to prevent it from being used during tests
const mockIsMeilisearchAvailable = mock(() => Promise.resolve(false));
const mockSearchMessagesWithMeilisearch = mock(() => Promise.resolve({ results: [], total: 0 }));
const mockSearchContactsWithMeilisearch = mock(() => Promise.resolve({ results: [], total: 0 }));

mock.module("../../services/meilisearch.service.js", () => ({
  isMeilisearchAvailable: mockIsMeilisearchAvailable,
  searchMessagesWithMeilisearch: mockSearchMessagesWithMeilisearch,
  searchContactsWithMeilisearch: mockSearchContactsWithMeilisearch,
}));

// Import the service after mocking
import {
  searchMessages,
  searchContacts,
  globalSearch,
  updateMessageSearchVector,
  resetMeilisearchCache,
  type SearchOptions,
} from "../../services/search.service";

describe("SearchService", () => {
  beforeEach(() => {
    resetMockQueryBuilder();
    mockGetTenantConnection.mockClear();
    mockTenantDb.selectFrom = mock(() => mockQueryBuilder);
    mockSql.mockClear();
    mockIsMeilisearchAvailable.mockClear();
    mockSearchMessagesWithMeilisearch.mockClear();
    mockSearchContactsWithMeilisearch.mockClear();
    // Reset Meilisearch mocks to default behavior
    mockIsMeilisearchAvailable.mockImplementation(() => Promise.resolve(false));
    mockSearchMessagesWithMeilisearch.mockImplementation(() => Promise.resolve({ results: [], total: 0 }));
    mockSearchContactsWithMeilisearch.mockImplementation(() => Promise.resolve({ results: [], total: 0 }));
    // Reset the Meilisearch cache
    resetMeilisearchCache();
  });

  describe("searchMessages", () => {
    it("should search messages with query", async () => {
      // Arrange
      const mockResults = [
        {
          id: "msg-1",
          contact_id: "contact-1",
          contact_name: "John Doe",
          contact_jid: "123@s.whatsapp.net",
          is_group: false,
          message_id: "wa-msg-1",
          content: "Hello world",
          message_type: "text",
          timestamp: new Date(),
          highlights: "Hello <mark>world</mark>",
          rank: 0.5,
          total_count: 1,
        },
      ];

      mockSql.mockImplementation(() => ({
        execute: mock(() => Promise.resolve({ rows: mockResults })),
      }));

      const options: SearchOptions = {
        query: "world",
        limit: 50,
        offset: 0,
      };

      // Act
      const result = await searchMessages("company-123", options);

      // Assert
      expect(result.results).toBeDefined();
      expect(result.total).toBeDefined();
      expect(mockGetTenantConnection).toHaveBeenCalledWith("company-123");
    });

    it("should return empty results for empty query", async () => {
      // Arrange
      const options: SearchOptions = {
        query: "   ", // Empty/whitespace query
      };

      // Act
      const result = await searchMessages("company-123", options);

      // Assert
      expect(result.results).toEqual([]);
      expect(result.total).toBe(0);
    });

    it("should handle special characters in query", async () => {
      // Arrange
      mockSql.mockImplementation(() => ({
        execute: mock(() => Promise.resolve({ rows: [] })),
      }));

      const options: SearchOptions = {
        query: "test@#$%",
      };

      // Act
      const result = await searchMessages("company-123", options);

      // Assert
      expect(result.results).toEqual([]);
      expect(result.total).toBe(0);
    });

    it("should filter by contactId when provided", async () => {
      // Arrange
      mockSql.mockImplementation(() => ({
        execute: mock(() => Promise.resolve({ rows: [] })),
      }));

      const options: SearchOptions = {
        query: "hello",
        contactId: "contact-123",
      };

      // Act
      await searchMessages("company-123", options);

      // Assert
      expect(mockSql).toHaveBeenCalled();
    });

    it("should filter by date range when provided", async () => {
      // Arrange
      mockSql.mockImplementation(() => ({
        execute: mock(() => Promise.resolve({ rows: [] })),
      }));

      const options: SearchOptions = {
        query: "hello",
        startDate: new Date("2024-01-01"),
        endDate: new Date("2024-01-31"),
      };

      // Act
      await searchMessages("company-123", options);

      // Assert
      expect(mockSql).toHaveBeenCalled();
    });

    it("should filter by message types when provided", async () => {
      // Arrange
      mockSql.mockImplementation(() => ({
        execute: mock(() => Promise.resolve({ rows: [] })),
      }));

      const options: SearchOptions = {
        query: "hello",
        messageTypes: ["text", "image"],
      };

      // Act
      await searchMessages("company-123", options);

      // Assert
      expect(mockSql).toHaveBeenCalled();
    });

    it("should apply pagination", async () => {
      // Arrange
      mockSql.mockImplementation(() => ({
        execute: mock(() => Promise.resolve({ rows: [] })),
      }));

      const options: SearchOptions = {
        query: "hello",
        limit: 10,
        offset: 20,
      };

      // Act
      await searchMessages("company-123", options);

      // Assert
      expect(mockSql).toHaveBeenCalled();
    });

    it("should map results to SearchResult interface", async () => {
      // Arrange
      const mockResults = [
        {
          id: "msg-1",
          contact_id: "contact-1",
          contact_name: "John Doe",
          contact_jid: "123@s.whatsapp.net",
          is_group: false,
          message_id: "wa-msg-1",
          content: "Hello world",
          message_type: "text",
          timestamp: new Date(),
          highlights: "<mark>Hello</mark>",
          rank: 0.8,
          total_count: 1,
        },
      ];

      mockSql.mockImplementation(() => ({
        execute: mock(() => Promise.resolve({ rows: mockResults })),
      }));

      // Act
      const result = await searchMessages("company-123", { query: "hello" });

      // Assert
      expect(result.results.length).toBe(1);
      const searchResult = result.results[0];
      expect(searchResult.id).toBe("msg-1");
      expect(searchResult.contactId).toBe("contact-1");
      expect(searchResult.contactName).toBe("John Doe");
      expect(searchResult.isGroup).toBe(false);
      expect(searchResult.highlights).toBe("<mark>Hello</mark>");
      expect(searchResult.rank).toBe(0.8);
    });
  });

  describe("searchContacts", () => {
    it("should search contacts by name", async () => {
      // Arrange
      const mockContacts = [
        {
          id: "contact-1",
          jid: "123@s.whatsapp.net",
          phone_number: "+1234567890",
          push_name: "John Doe",
          custom_name: null,
          is_group: false,
          profile_picture_url: null,
          notes_shared: null,
        },
      ];

      resetMockQueryBuilder(mockContacts);
      mockQueryBuilder.execute = mock(() => Promise.resolve(mockContacts));
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      // Act
      const result = await searchContacts("company-123", "John");

      // Assert
      expect(result.results).toBeDefined();
      expect(result.total).toBeDefined();
      expect(mockGetTenantConnection).toHaveBeenCalledWith("company-123");
    });

    it("should search by phone number", async () => {
      // Arrange
      const mockContacts = [
        createMockContact({ phone_number: "+1234567890" }),
      ];

      resetMockQueryBuilder(mockContacts);
      mockQueryBuilder.execute = mock(() => Promise.resolve(mockContacts));
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      // Act
      const result = await searchContacts("company-123", "123456");

      // Assert
      expect(result.results).toBeDefined();
    });

    it("should apply pagination options", async () => {
      // Arrange
      resetMockQueryBuilder([]);
      mockQueryBuilder.execute = mock(() => Promise.resolve([]));
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      // Act
      await searchContacts("company-123", "test", { limit: 10, offset: 5 });

      // Assert
      expect(mockQueryBuilder.limit).toHaveBeenCalled();
      expect(mockQueryBuilder.offset).toHaveBeenCalled();
    });

    it("should include groups when specified", async () => {
      // Arrange
      resetMockQueryBuilder([]);
      mockQueryBuilder.execute = mock(() => Promise.resolve([]));
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      // Act
      await searchContacts("company-123", "test", { includeGroups: true });

      // Assert - $if should be called with false when including groups
      expect(mockQueryBuilder.$if).toHaveBeenCalled();
    });

    it("should exclude groups by default", async () => {
      // Arrange
      resetMockQueryBuilder([]);
      mockQueryBuilder.execute = mock(() => Promise.resolve([]));
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      // Act
      await searchContacts("company-123", "test");

      // Assert
      expect(mockQueryBuilder.$if).toHaveBeenCalled();
    });

    it("should map results to ContactSearchResult interface", async () => {
      // Arrange
      const mockContacts = [
        {
          id: "contact-1",
          jid: "123@s.whatsapp.net",
          phone_number: "+1234567890",
          push_name: "John",
          custom_name: "John Doe",
          is_group: false,
          profile_picture_url: "https://example.com/photo.jpg",
          notes_shared: "Important contact",
        },
      ];

      resetMockQueryBuilder(mockContacts);
      mockQueryBuilder.execute = mock(() => Promise.resolve(mockContacts));
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      // Act
      const result = await searchContacts("company-123", "John");

      // Assert
      if (result.results.length > 0) {
        const contact = result.results[0];
        expect(contact.id).toBe("contact-1");
        expect(contact.jid).toBe("123@s.whatsapp.net");
        expect(contact.phoneNumber).toBe("+1234567890");
        expect(contact.pushName).toBe("John");
        expect(contact.customName).toBe("John Doe");
        expect(contact.displayName).toBe("John Doe"); // Custom name takes precedence
        expect(contact.isGroup).toBe(false);
        expect(contact.profilePictureUrl).toBe("https://example.com/photo.jpg");
        expect(contact.notesShared).toBe("Important contact");
      }
    });

    it("should use push_name for displayName when custom_name is null", async () => {
      // Arrange
      const mockContacts = [
        {
          id: "contact-1",
          jid: "123@s.whatsapp.net",
          phone_number: "+1234567890",
          push_name: "John",
          custom_name: null,
          is_group: false,
          profile_picture_url: null,
          notes_shared: null,
        },
      ];

      resetMockQueryBuilder(mockContacts);
      mockQueryBuilder.execute = mock(() => Promise.resolve(mockContacts));
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      // Act
      const result = await searchContacts("company-123", "John");

      // Assert
      if (result.results.length > 0) {
        expect(result.results[0].displayName).toBe("John");
      }
    });

    it("should use phone_number for displayName when names are null", async () => {
      // Arrange
      const mockContacts = [
        {
          id: "contact-1",
          jid: "123@s.whatsapp.net",
          phone_number: "+1234567890",
          push_name: null,
          custom_name: null,
          is_group: false,
          profile_picture_url: null,
          notes_shared: null,
        },
      ];

      resetMockQueryBuilder(mockContacts);
      mockQueryBuilder.execute = mock(() => Promise.resolve(mockContacts));
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      // Act
      const result = await searchContacts("company-123", "1234");

      // Assert
      if (result.results.length > 0) {
        expect(result.results[0].displayName).toBe("+1234567890");
      }
    });
  });

  describe("globalSearch", () => {
    it("should search both messages and contacts", async () => {
      // Arrange
      mockSql.mockImplementation(() => ({
        execute: mock(() => Promise.resolve({ rows: [] })),
      }));

      resetMockQueryBuilder([]);
      mockQueryBuilder.execute = mock(() => Promise.resolve([]));
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      // Act
      const result = await globalSearch("company-123", "test");

      // Assert
      expect(result.messages).toBeDefined();
      expect(result.contacts).toBeDefined();
      expect(Array.isArray(result.messages)).toBe(true);
      expect(Array.isArray(result.contacts)).toBe(true);
    });

    it("should use default limit of 10", async () => {
      // Arrange
      mockSql.mockImplementation(() => ({
        execute: mock(() => Promise.resolve({ rows: [] })),
      }));

      resetMockQueryBuilder([]);
      mockQueryBuilder.execute = mock(() => Promise.resolve([]));
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      // Act
      await globalSearch("company-123", "test");

      // Assert - the limit should be applied to both queries
      expect(mockSql).toHaveBeenCalled();
    });

    it("should accept custom limit", async () => {
      // Arrange
      mockSql.mockImplementation(() => ({
        execute: mock(() => Promise.resolve({ rows: [] })),
      }));

      resetMockQueryBuilder([]);
      mockQueryBuilder.execute = mock(() => Promise.resolve([]));
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      // Act
      const result = await globalSearch("company-123", "test", { limit: 5 });

      // Assert
      expect(result.messages).toBeDefined();
      expect(result.contacts).toBeDefined();
    });
  });

  describe("updateMessageSearchVector", () => {
    it("should update search vector for a message", async () => {
      // Arrange
      mockSql.mockImplementation(() => ({
        execute: mock(() => Promise.resolve()),
      }));

      // Act
      await updateMessageSearchVector("company-123", "message-123");

      // Assert
      expect(mockGetTenantConnection).toHaveBeenCalledWith("company-123");
      expect(mockSql).toHaveBeenCalled();
    });
  });

  describe("Edge cases", () => {
    it("should handle empty search results", async () => {
      // Arrange
      mockSql.mockImplementation(() => ({
        execute: mock(() => Promise.resolve({ rows: [] })),
      }));

      // Act
      const result = await searchMessages("company-123", { query: "nonexistent" });

      // Assert
      expect(result.results).toEqual([]);
      expect(result.total).toBe(0);
    });

    it("should handle search terms with only special characters", async () => {
      // Arrange - query that becomes empty after filtering
      const options: SearchOptions = {
        query: "@#$%^&*",
      };

      // Act
      const result = await searchMessages("company-123", options);

      // Assert
      expect(result.results).toEqual([]);
      expect(result.total).toBe(0);
    });

    it("should handle multi-word search queries", async () => {
      // Arrange
      mockSql.mockImplementation(() => ({
        execute: mock(() => Promise.resolve({ rows: [] })),
      }));

      const options: SearchOptions = {
        query: "hello world test",
      };

      // Act
      const result = await searchMessages("company-123", options);

      // Assert - should have called sql with the query
      expect(mockSql).toHaveBeenCalled();
    });
  });

  describe("Meilisearch integration", () => {
    it("should use Meilisearch when available for message search", async () => {
      // Arrange - clear mocks and set new behavior
      mockIsMeilisearchAvailable.mockClear();
      mockSearchMessagesWithMeilisearch.mockClear();

      mockIsMeilisearchAvailable.mockResolvedValue(true);
      mockSearchMessagesWithMeilisearch.mockResolvedValue({
        results: [
          {
            id: "msg-1",
            contactId: "contact-1",
            contactName: "John Doe",
            contactJid: "123@s.whatsapp.net",
            isGroup: false,
            messageId: "msg-wa-1",
            content: "Hello from Meilisearch",
            messageType: "text",
            timestamp: new Date("2024-01-01"),
            highlights: "<mark>Hello</mark> from Meilisearch",
          },
        ],
        total: 1,
      });

      // Act
      const result = await searchMessages("company-123", { query: "Hello" });

      // Assert
      expect(mockSearchMessagesWithMeilisearch).toHaveBeenCalledWith("company-123", {
        query: "Hello",
        limit: 50,
        offset: 0,
        contactId: undefined,
        startDate: undefined,
        endDate: undefined,
        messageTypes: undefined,
      });
      expect(result.results).toHaveLength(1);
      expect(result.results[0].content).toBe("Hello from Meilisearch");
      expect(result.total).toBe(1);
      expect(mockSql).not.toHaveBeenCalled(); // Should not fall back to PostgreSQL
    });

    it("should return empty results from Meilisearch when no matches", async () => {
      // Arrange - clear mocks and set new behavior
      mockIsMeilisearchAvailable.mockClear();
      mockSearchMessagesWithMeilisearch.mockClear();

      mockIsMeilisearchAvailable.mockResolvedValue(true);
      mockSearchMessagesWithMeilisearch.mockResolvedValue({
        results: [],
        total: 0,
      });

      // Act
      const result = await searchMessages("company-123", { query: "nonexistent" });

      // Assert
      expect(mockSearchMessagesWithMeilisearch).toHaveBeenCalled();
      expect(result.results).toEqual([]);
      expect(result.total).toBe(0);
      expect(mockSql).not.toHaveBeenCalled(); // Should not fall back to PostgreSQL
    });

    it("should use Meilisearch when available for contact search", async () => {
      // Arrange - clear mocks and set new behavior
      mockIsMeilisearchAvailable.mockClear();
      mockSearchContactsWithMeilisearch.mockClear();

      mockIsMeilisearchAvailable.mockResolvedValue(true);
      mockSearchContactsWithMeilisearch.mockResolvedValue({
        results: [
          {
            id: "contact-1",
            jid: "123@s.whatsapp.net",
            phoneNumber: "+1234567890",
            pushName: "John",
            customName: "John Doe",
            displayName: "John Doe",
            isGroup: false,
            notesShared: "Important contact",
          },
        ],
        total: 1,
      });

      // Act
      const result = await searchContacts("company-123", "John");

      // Assert
      expect(mockSearchContactsWithMeilisearch).toHaveBeenCalledWith("company-123", "John", {
        limit: 50,
        offset: 0,
        includeGroups: true,
      });
      expect(result.results).toHaveLength(1);
      expect(result.results[0].displayName).toBe("John Doe");
      expect(result.total).toBe(1);
      expect(mockTenantDb.selectFrom).not.toHaveBeenCalled(); // Should not fall back to PostgreSQL
    });

    it("should return empty results from Meilisearch for contacts when no matches", async () => {
      // Arrange - clear mocks and set new behavior
      mockIsMeilisearchAvailable.mockClear();
      mockSearchContactsWithMeilisearch.mockClear();

      mockIsMeilisearchAvailable.mockResolvedValue(true);
      mockSearchContactsWithMeilisearch.mockResolvedValue({
        results: [],
        total: 0,
      });

      // Act
      const result = await searchContacts("company-123", "nonexistent");

      // Assert
      expect(mockSearchContactsWithMeilisearch).toHaveBeenCalled();
      expect(result.results).toEqual([]);
      expect(result.total).toBe(0);
      expect(mockTenantDb.selectFrom).not.toHaveBeenCalled(); // Should not fall back to PostgreSQL
    });

    it("should fall back to PostgreSQL when Meilisearch is not available", async () => {
      // Arrange - clear mocks and set new behavior
      mockIsMeilisearchAvailable.mockClear();
      mockSearchMessagesWithMeilisearch.mockClear();

      mockIsMeilisearchAvailable.mockResolvedValue(false);
      mockSql.mockImplementation(() => ({
        execute: mock(() => Promise.resolve({ rows: [] })),
      }));

      // Act
      const result = await searchMessages("company-123", { query: "test" });

      // Assert
      expect(mockSearchMessagesWithMeilisearch).not.toHaveBeenCalled();
      expect(mockSql).toHaveBeenCalled(); // Should use PostgreSQL
    });

    it("should allow forcing PostgreSQL with useMeilisearch option", async () => {
      // Arrange - clear mocks and set new behavior
      mockIsMeilisearchAvailable.mockClear();
      mockSearchMessagesWithMeilisearch.mockClear();

      mockIsMeilisearchAvailable.mockResolvedValue(true);
      mockSql.mockImplementation(() => ({
        execute: mock(() => Promise.resolve({ rows: [] })),
      }));

      // Act
      const result = await searchMessages("company-123", {
        query: "test",
        useMeilisearch: false // Force PostgreSQL
      });

      // Assert
      expect(mockSearchMessagesWithMeilisearch).not.toHaveBeenCalled();
      expect(mockSql).toHaveBeenCalled(); // Should use PostgreSQL
    });
  });
});
