/**
 * Unit tests for export.service.ts
 *
 * Tests export functionality including:
 * - Contact export
 * - Message export
 * - Conversation export
 * - CSV conversion
 */

import { describe, it, expect, mock, beforeEach } from "bun:test";
import { createMutableMockQueryBuilder, resetMockQueryBuilder } from "../mocks";

// Mock query builder - using centralized mock utilities
let mockQueryBuilder = createMutableMockQueryBuilder();

// Mock tenant database
const mockTenantDb = {
  selectFrom: mock(() => mockQueryBuilder),
};

// Mock sql template with sql.raw support
const createMockSql = () => {
  const mockSqlFn = mock(
    (_strings: TemplateStringsArray, ..._values: unknown[]) => ({
      execute: mock(() =>
        Promise.resolve({
          rows: [],
        }),
      ),
    }),
  );

  // Add sql.raw method
  (mockSqlFn as unknown as { raw: typeof mock }).raw = mock(
    (value: string) => ({
      __raw: value,
    }),
  );

  return mockSqlFn;
};

const mockSql = createMockSql();

// Mock getTenantConnection
const mockGetTenantConnection = mock((_companyId: string) => mockTenantDb);

mock.module("../../services/tenant.service.js", () => ({
  getTenantConnection: mockGetTenantConnection,
}));

mock.module("kysely", () => ({
  sql: mockSql,
}));

// Mock fflate - supports both sync and async versions
const mockZipSync = mock((files: Record<string, Uint8Array>) => {
  // Return a simple Uint8Array that encodes the file names for testing
  const encoder = new TextEncoder();
  const fileNames = Object.keys(files).join(",");
  return encoder.encode(`mock-zip:${fileNames}`);
});

// Store last captured files for inspection in tests
let lastCapturedFiles: Record<string, Uint8Array> | null = null;

// Async zip mock for the Promise-based API
const mockZip = mock(
  (
    files: Record<string, Uint8Array>,
    _options: unknown,
    callback: (err: Error | null, data: Uint8Array) => void,
  ) => {
    // Capture files for test inspection
    lastCapturedFiles = files;
    const encoder = new TextEncoder();
    const fileNames = Object.keys(files).join(",");
    const result = encoder.encode(`mock-zip:${fileNames}`);
    // Call callback asynchronously to simulate real behavior
    setTimeout(() => callback(null, result), 0);
  },
);

// Helper to get captured files in tests
function getLastCapturedFiles(): Record<string, Uint8Array> | null {
  return lastCapturedFiles;
}

// Helper to reset captured files
function resetCapturedFiles(): void {
  lastCapturedFiles = null;
}

mock.module("fflate", () => ({
  zipSync: mockZipSync,
  zip: mockZip,
}));

// Import the service after mocking
import {
  exportContacts,
  exportMessages,
  exportConversation,
  exportFullBackup,
  toCSV,
  type ContactExport,
  type MessageExport,
} from "../../services/export.service";

describe("ExportService", () => {
  beforeEach(() => {
    resetMockQueryBuilder(mockQueryBuilder);
    resetCapturedFiles();
    mockGetTenantConnection.mockClear();
    mockTenantDb.selectFrom = mock(() => mockQueryBuilder);
    mockSql.mockClear();
  });

  describe("exportContacts", () => {
    it("should export all contacts", async () => {
      // Arrange
      const mockContacts = [
        {
          whatsapp_id: "123@s.whatsapp.net",
          phone_number: "+1234567890",
          push_name: "John Doe",
          custom_name: "John",
          shared_notes: "Important contact",
          tags: "vip,customer",
          assigned_to: "user-123",
          created_at: new Date("2024-01-01"),
          last_message_at: new Date("2024-01-15"),
        },
      ];

      mockSql.mockImplementation(() => ({
        execute: mock(() => Promise.resolve({ rows: mockContacts })),
      }));

      // Act
      const result = await exportContacts("company-123");

      // Assert
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
      expect(result[0].whatsapp_id).toBe("123@s.whatsapp.net");
    });

    it("should filter by tag IDs", async () => {
      // Arrange
      mockSql.mockImplementation(() => ({
        execute: mock(() => Promise.resolve({ rows: [] })),
      }));

      // Act
      await exportContacts("company-123", { tagIds: ["tag-1", "tag-2"] });

      // Assert
      expect(mockSql).toHaveBeenCalled();
    });

    it("should filter by assigned user", async () => {
      // Arrange
      mockSql.mockImplementation(() => ({
        execute: mock(() => Promise.resolve({ rows: [] })),
      }));

      // Act
      await exportContacts("company-123", { assignedTo: "user-123" });

      // Assert
      expect(mockSql).toHaveBeenCalled();
    });

    it("should filter by custom name presence", async () => {
      // Arrange
      mockSql.mockImplementation(() => ({
        execute: mock(() => Promise.resolve({ rows: [] })),
      }));

      // Act
      await exportContacts("company-123", { hasCustomName: true });

      // Assert
      expect(mockSql).toHaveBeenCalled();
    });

    it("should format dates as ISO strings", async () => {
      // Arrange
      const date = new Date("2024-01-15T12:00:00Z");
      const mockContacts = [
        {
          whatsapp_id: "123@s.whatsapp.net",
          phone_number: "+1234567890",
          push_name: "John",
          custom_name: null,
          shared_notes: null,
          tags: null,
          assigned_to: null,
          created_at: date,
          last_message_at: date,
        },
      ];

      mockSql.mockImplementation(() => ({
        execute: mock(() => Promise.resolve({ rows: mockContacts })),
      }));

      // Act
      const result = await exportContacts("company-123");

      // Assert
      expect(result[0].created_at).toBe(date.toISOString());
      expect(result[0].last_message_at).toBe(date.toISOString());
    });

    it("should handle null last_message_at", async () => {
      // Arrange
      const mockContacts = [
        {
          whatsapp_id: "123@s.whatsapp.net",
          phone_number: "+1234567890",
          push_name: "John",
          custom_name: null,
          shared_notes: null,
          tags: null,
          assigned_to: null,
          created_at: new Date(),
          last_message_at: null,
        },
      ];

      mockSql.mockImplementation(() => ({
        execute: mock(() => Promise.resolve({ rows: mockContacts })),
      }));

      // Act
      const result = await exportContacts("company-123");

      // Assert
      expect(result[0].last_message_at).toBeNull();
    });

    it("should handle empty tags", async () => {
      // Arrange
      const mockContacts = [
        {
          whatsapp_id: "123@s.whatsapp.net",
          phone_number: null,
          push_name: null,
          custom_name: null,
          shared_notes: null,
          tags: null,
          assigned_to: null,
          created_at: new Date(),
          last_message_at: null,
        },
      ];

      mockSql.mockImplementation(() => ({
        execute: mock(() => Promise.resolve({ rows: mockContacts })),
      }));

      // Act
      const result = await exportContacts("company-123");

      // Assert
      expect(result[0].tags).toBe("");
    });
  });

  describe("exportMessages", () => {
    it("should export all messages", async () => {
      // Arrange
      const mockMessages = [
        {
          message_id: "wa-msg-123",
          contact_whatsapp_id: "123@s.whatsapp.net",
          contact_name: "John Doe",
          from_me: true,
          message_type: "text",
          text_content: "Hello",
          timestamp: new Date("2024-01-15"),
          sent_by_user: "user-123",
          media_url: null,
        },
      ];

      mockSql.mockImplementation(() => ({
        execute: mock(() => Promise.resolve({ rows: mockMessages })),
      }));

      // Act
      const result = await exportMessages("company-123");

      // Assert
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
      expect(result[0].message_id).toBe("wa-msg-123");
    });

    it("should filter by contact ID", async () => {
      // Arrange
      mockSql.mockImplementation(() => ({
        execute: mock(() => Promise.resolve({ rows: [] })),
      }));

      // Act
      await exportMessages("company-123", { contactId: "contact-123" });

      // Assert
      expect(mockSql).toHaveBeenCalled();
    });

    it("should filter by date range", async () => {
      // Arrange
      mockSql.mockImplementation(() => ({
        execute: mock(() => Promise.resolve({ rows: [] })),
      }));

      // Act
      await exportMessages("company-123", {
        startDate: new Date("2024-01-01"),
        endDate: new Date("2024-01-31"),
      });

      // Assert
      expect(mockSql).toHaveBeenCalled();
    });

    it("should filter by message types", async () => {
      // Arrange
      mockSql.mockImplementation(() => ({
        execute: mock(() => Promise.resolve({ rows: [] })),
      }));

      // Act
      await exportMessages("company-123", { messageTypes: ["text", "image"] });

      // Assert
      expect(mockSql).toHaveBeenCalled();
    });

    it("should apply limit", async () => {
      // Arrange
      mockSql.mockImplementation(() => ({
        execute: mock(() => Promise.resolve({ rows: [] })),
      }));

      // Act
      await exportMessages("company-123", { limit: 100 });

      // Assert
      expect(mockSql).toHaveBeenCalled();
    });

    it("should map direction based on from_me flag", async () => {
      // Arrange
      const mockMessages = [
        {
          message_id: "msg-1",
          contact_whatsapp_id: "123@s.whatsapp.net",
          contact_name: null,
          from_me: true,
          message_type: "text",
          text_content: "Hello",
          timestamp: new Date(),
          sent_by_user: null,
          media_url: null,
        },
        {
          message_id: "msg-2",
          contact_whatsapp_id: "123@s.whatsapp.net",
          contact_name: null,
          from_me: false,
          message_type: "text",
          text_content: "Hi",
          timestamp: new Date(),
          sent_by_user: null,
          media_url: null,
        },
      ];

      mockSql.mockImplementation(() => ({
        execute: mock(() => Promise.resolve({ rows: mockMessages })),
      }));

      // Act
      const result = await exportMessages("company-123");

      // Assert
      expect(result[0].direction).toBe("sent");
      expect(result[1].direction).toBe("received");
    });

    it("should indicate has_media based on media_url", async () => {
      // Arrange
      const mockMessages = [
        {
          message_id: "msg-1",
          contact_whatsapp_id: "123@s.whatsapp.net",
          contact_name: null,
          from_me: true,
          message_type: "image",
          text_content: null,
          timestamp: new Date(),
          sent_by_user: null,
          media_url: "https://example.com/image.jpg",
        },
        {
          message_id: "msg-2",
          contact_whatsapp_id: "123@s.whatsapp.net",
          contact_name: null,
          from_me: false,
          message_type: "text",
          text_content: "Hi",
          timestamp: new Date(),
          sent_by_user: null,
          media_url: null,
        },
      ];

      mockSql.mockImplementation(() => ({
        execute: mock(() => Promise.resolve({ rows: mockMessages })),
      }));

      // Act
      const result = await exportMessages("company-123");

      // Assert
      expect(result[0].has_media).toBe(true);
      expect(result[1].has_media).toBe(false);
    });

    it("should handle null message_id", async () => {
      // Arrange
      const mockMessages = [
        {
          message_id: null,
          contact_whatsapp_id: "123@s.whatsapp.net",
          contact_name: null,
          from_me: true,
          message_type: "text",
          text_content: "Hello",
          timestamp: new Date(),
          sent_by_user: null,
          media_url: null,
        },
      ];

      mockSql.mockImplementation(() => ({
        execute: mock(() => Promise.resolve({ rows: mockMessages })),
      }));

      // Act
      const result = await exportMessages("company-123");

      // Assert
      expect(result[0].message_id).toBe("");
    });
  });

  describe("exportConversation", () => {
    it("should export contact and messages together", async () => {
      // Arrange
      const mockContact = {
        whatsapp_id: "123@s.whatsapp.net",
        phone_number: "+1234567890",
        push_name: "John",
        custom_name: null,
        shared_notes: null,
        tags: null,
        assigned_to: null,
        created_at: new Date(),
        last_message_at: new Date(),
      };

      const mockMessages = [
        {
          message_id: "msg-1",
          contact_whatsapp_id: "123@s.whatsapp.net",
          contact_name: "John",
          from_me: false,
          message_type: "text",
          text_content: "Hello",
          timestamp: new Date(),
          sent_by_user: null,
          media_url: null,
        },
      ];

      let sqlCallCount = 0;
      mockSql.mockImplementation(() => ({
        execute: mock(() => {
          sqlCallCount++;
          if (sqlCallCount === 1) {
            return Promise.resolve({ rows: [mockContact] });
          }
          return Promise.resolve({ rows: mockMessages });
        }),
      }));

      // Act
      const result = await exportConversation("company-123", "contact-123");

      // Assert
      expect(result.contact).toBeDefined();
      expect(result.messages).toBeDefined();
      expect(Array.isArray(result.messages)).toBe(true);
    });

    it("should throw error for non-existent contact", async () => {
      // Arrange
      mockSql.mockImplementation(() => ({
        execute: mock(() => Promise.resolve({ rows: [] })),
      }));

      // Act & Assert
      await expect(
        exportConversation("company-123", "non-existent"),
      ).rejects.toThrow("Contact not found");
    });

    it("should apply date filters to messages", async () => {
      // Arrange
      const mockContact = {
        whatsapp_id: "123@s.whatsapp.net",
        phone_number: null,
        push_name: null,
        custom_name: null,
        shared_notes: null,
        tags: null,
        assigned_to: null,
        created_at: new Date(),
        last_message_at: null,
      };

      let sqlCallCount = 0;
      mockSql.mockImplementation(() => ({
        execute: mock(() => {
          sqlCallCount++;
          if (sqlCallCount === 1) {
            return Promise.resolve({ rows: [mockContact] });
          }
          return Promise.resolve({ rows: [] });
        }),
      }));

      // Act
      const result = await exportConversation("company-123", "contact-123", {
        startDate: new Date("2024-01-01"),
        endDate: new Date("2024-01-31"),
      });

      // Assert
      expect(result.contact).toBeDefined();
      expect(result.messages).toEqual([]);
    });

    it("should return messages in chronological order", async () => {
      // Arrange
      const mockContact = {
        whatsapp_id: "123@s.whatsapp.net",
        phone_number: null,
        push_name: null,
        custom_name: null,
        shared_notes: null,
        tags: null,
        assigned_to: null,
        created_at: new Date(),
        last_message_at: null,
      };

      // Messages are returned in reverse order from the query
      const mockMessages = [
        {
          message_id: "msg-2",
          contact_whatsapp_id: "123",
          contact_name: null,
          from_me: true,
          message_type: "text",
          text_content: "Second",
          timestamp: new Date("2024-01-02"),
          sent_by_user: null,
          media_url: null,
        },
        {
          message_id: "msg-1",
          contact_whatsapp_id: "123",
          contact_name: null,
          from_me: false,
          message_type: "text",
          text_content: "First",
          timestamp: new Date("2024-01-01"),
          sent_by_user: null,
          media_url: null,
        },
      ];

      let sqlCallCount = 0;
      mockSql.mockImplementation(() => ({
        execute: mock(() => {
          sqlCallCount++;
          if (sqlCallCount === 1) {
            return Promise.resolve({ rows: [mockContact] });
          }
          return Promise.resolve({ rows: mockMessages });
        }),
      }));

      // Act
      const result = await exportConversation("company-123", "contact-123");

      // Assert - messages should be reversed to chronological order
      expect(result.messages.length).toBe(2);
      expect(result.messages[0].message_id).toBe("msg-1"); // First message first
    });
  });

  describe("toCSV", () => {
    it("should convert array of objects to CSV", () => {
      // Arrange
      const data: ContactExport[] = [
        {
          whatsapp_id: "123",
          phone_number: "+1234567890",
          push_name: "John",
          custom_name: null,
          shared_notes: null,
          tags: "vip",
          assigned_to: null,
          created_at: "2024-01-01T00:00:00Z",
          last_message_at: null,
        },
      ];

      // Act
      const result = toCSV(data);

      // Assert
      expect(result).toContain("whatsapp_id");
      expect(result).toContain("123");
      expect(result).toContain("+1234567890");
    });

    it("should return empty string for empty array", () => {
      // Act
      const result = toCSV([]);

      // Assert
      expect(result).toBe("");
    });

    it("should use provided columns", () => {
      // Arrange
      const data = [{ a: "1", b: "2", c: "3" }];

      // Act
      const result = toCSV(data, ["a", "c"]);

      // Assert
      expect(result).toContain("a,c");
      expect(result).toContain("1,3");
      expect(result).not.toContain("b");
    });

    it("should escape values containing commas", () => {
      // Arrange
      const data = [{ name: "Doe, John", id: "123" }];

      // Act
      const result = toCSV(data);

      // Assert
      expect(result).toContain('"Doe, John"');
    });

    it("should escape values containing newlines", () => {
      // Arrange
      const data = [{ notes: "Line 1\nLine 2", id: "123" }];

      // Act
      const result = toCSV(data);

      // Assert
      expect(result).toContain('"Line 1\nLine 2"');
    });

    it("should escape quotes within values", () => {
      // Arrange
      const data = [{ text: 'He said "hello"', id: "123" }];

      // Act
      const result = toCSV(data);

      // Assert
      expect(result).toContain('"He said ""hello"""');
    });

    it("should handle null and undefined values", () => {
      // Arrange
      const data = [{ a: null, b: undefined, c: "value" }];

      // Act
      const result = toCSV(data as Record<string, unknown>[]);

      // Assert
      expect(result).toContain("a,b,c");
      expect(result).toContain(",,value");
    });

    it("should convert non-string values to strings", () => {
      // Arrange
      const data = [
        { number: 123, boolean: true, date: new Date("2024-01-01") },
      ];

      // Act
      const result = toCSV(data as Record<string, unknown>[]);

      // Assert
      expect(result).toContain("123");
      expect(result).toContain("true");
    });

    it("should create header row from first object keys", () => {
      // Arrange
      const data = [
        { first_name: "John", last_name: "Doe", email: "john@example.com" },
      ];

      // Act
      const result = toCSV(data);
      const lines = result.split("\n");

      // Assert
      expect(lines[0]).toBe("first_name,last_name,email");
    });

    it("should handle multiple rows", () => {
      // Arrange
      const data = [
        { id: "1", name: "John" },
        { id: "2", name: "Jane" },
        { id: "3", name: "Bob" },
      ];

      // Act
      const result = toCSV(data);
      const lines = result.split("\n");

      // Assert
      expect(lines.length).toBe(4); // Header + 3 data rows
      expect(lines[0]).toBe("id,name");
      expect(lines[1]).toBe("1,John");
      expect(lines[2]).toBe("2,Jane");
      expect(lines[3]).toBe("3,Bob");
    });
  });

  describe("Type definitions", () => {
    it("ContactExport should have correct structure", async () => {
      // Arrange
      const mockContacts = [
        {
          whatsapp_id: "123",
          phone_number: "+1234567890",
          push_name: "John",
          custom_name: null,
          shared_notes: null,
          tags: null,
          assigned_to: null,
          created_at: new Date(),
          last_message_at: null,
        },
      ];

      mockSql.mockImplementation(() => ({
        execute: mock(() => Promise.resolve({ rows: mockContacts })),
      }));

      // Act
      const result = await exportContacts("company-123");

      // Assert
      if (result.length > 0) {
        expect("whatsapp_id" in result[0]).toBe(true);
        expect("phone_number" in result[0]).toBe(true);
        expect("push_name" in result[0]).toBe(true);
        expect("custom_name" in result[0]).toBe(true);
        expect("shared_notes" in result[0]).toBe(true);
        expect("tags" in result[0]).toBe(true);
        expect("assigned_to" in result[0]).toBe(true);
        expect("created_at" in result[0]).toBe(true);
        expect("last_message_at" in result[0]).toBe(true);
      }
    });

    it("MessageExport should have correct structure", async () => {
      // Arrange
      const mockMessages = [
        {
          message_id: "msg-1",
          contact_whatsapp_id: "123",
          contact_name: "John",
          from_me: true,
          message_type: "text",
          text_content: "Hello",
          timestamp: new Date(),
          sent_by_user: null,
          media_url: null,
        },
      ];

      mockSql.mockImplementation(() => ({
        execute: mock(() => Promise.resolve({ rows: mockMessages })),
      }));

      // Act
      const result = await exportMessages("company-123");

      // Assert
      if (result.length > 0) {
        expect("message_id" in result[0]).toBe(true);
        expect("contact_whatsapp_id" in result[0]).toBe(true);
        expect("contact_name" in result[0]).toBe(true);
        expect("direction" in result[0]).toBe(true);
        expect("message_type" in result[0]).toBe(true);
        expect("text_content" in result[0]).toBe(true);
        expect("timestamp" in result[0]).toBe(true);
        expect("sent_by_user" in result[0]).toBe(true);
        expect("has_media" in result[0]).toBe(true);
      }
    });
  });

  describe("exportFullBackup", () => {
    beforeEach(() => {
      mockZipSync.mockClear();
    });

    it("should create a ZIP file with all required files", async () => {
      // Arrange
      const mockContacts = [
        {
          whatsapp_id: "123@s.whatsapp.net",
          phone_number: "+1234567890",
          push_name: "John",
          custom_name: null,
          shared_notes: null,
          tags: null,
          assigned_to: null,
          created_at: new Date("2024-01-01"),
          last_message_at: new Date("2024-01-15"),
        },
      ];

      const mockMessages = [
        {
          message_id: "msg-1",
          contact_whatsapp_id: "123@s.whatsapp.net",
          contact_name: "John",
          from_me: true,
          message_type: "text",
          text_content: "Hello",
          timestamp: new Date("2024-01-15"),
          sent_by_user: "user-123",
          media_url: null,
        },
      ];

      let sqlCallCount = 0;
      mockSql.mockImplementation(() => ({
        execute: mock(() => {
          sqlCallCount++;
          if (sqlCallCount === 1) {
            return Promise.resolve({ rows: mockContacts });
          }
          return Promise.resolve({ rows: mockMessages });
        }),
      }));

      // Act
      const result = await exportFullBackup("company-123");

      // Assert
      expect(result).toBeInstanceOf(Uint8Array);
      expect(mockZip).toHaveBeenCalled();

      // Check that required files are included
      const decoder = new TextDecoder();
      const zipContent = decoder.decode(result);
      expect(zipContent).toContain("README.txt");
      expect(zipContent).toContain("contacts.json");
      expect(zipContent).toContain("contacts.csv");
      expect(zipContent).toContain("messages.json");
      expect(zipContent).toContain("messages.csv");
      expect(zipContent).toContain("backup-summary.json");
    });

    it("should apply date filters to messages", async () => {
      // Arrange
      mockSql.mockImplementation(() => ({
        execute: mock(() => Promise.resolve({ rows: [] })),
      }));

      // Act
      await exportFullBackup("company-123", {
        startDate: new Date("2024-01-01"),
        endDate: new Date("2024-01-31"),
      });

      // Assert
      expect(mockSql).toHaveBeenCalled();
      expect(mockZip).toHaveBeenCalled();
    });

    it("should include correct stats in backup", async () => {
      // Arrange
      const mockContacts = [
        {
          whatsapp_id: "1",
          phone_number: null,
          push_name: null,
          custom_name: null,
          shared_notes: null,
          tags: null,
          assigned_to: null,
          created_at: new Date(),
          last_message_at: null,
        },
        {
          whatsapp_id: "2",
          phone_number: null,
          push_name: null,
          custom_name: null,
          shared_notes: null,
          tags: null,
          assigned_to: null,
          created_at: new Date(),
          last_message_at: null,
        },
      ];

      const mockMessages = [
        {
          message_id: "m1",
          contact_whatsapp_id: "1",
          contact_name: null,
          from_me: true,
          message_type: "text",
          text_content: "Hi",
          timestamp: new Date("2024-01-01"),
          sent_by_user: null,
          media_url: null,
        },
        {
          message_id: "m2",
          contact_whatsapp_id: "1",
          contact_name: null,
          from_me: false,
          message_type: "text",
          text_content: "Hello",
          timestamp: new Date("2024-01-15"),
          sent_by_user: null,
          media_url: null,
        },
      ];

      let sqlCallCount = 0;
      mockSql.mockImplementation(() => ({
        execute: mock(() => {
          sqlCallCount++;
          if (sqlCallCount === 1) {
            return Promise.resolve({ rows: mockContacts });
          }
          return Promise.resolve({ rows: mockMessages });
        }),
      }));

      // Act
      await exportFullBackup("company-123");

      // Assert
      expect(mockZip).toHaveBeenCalled();
      const files = getLastCapturedFiles();
      expect(files).not.toBeNull();

      // Check backup-summary.json content
      const decoder = new TextDecoder();
      const summaryContent = decoder.decode(files!["backup-summary.json"]);
      const summary = JSON.parse(summaryContent);

      expect(summary.stats.totalContacts).toBe(2);
      expect(summary.stats.totalMessages).toBe(2);
      expect(summary.exportedAt).toBeDefined();
    });

    it("should handle empty data gracefully", async () => {
      // Arrange
      mockSql.mockImplementation(() => ({
        execute: mock(() => Promise.resolve({ rows: [] })),
      }));

      // Act
      const result = await exportFullBackup("company-123");

      // Assert
      expect(result).toBeInstanceOf(Uint8Array);
      expect(mockZip).toHaveBeenCalled();

      const files = getLastCapturedFiles();
      expect(files).not.toBeNull();

      const decoder = new TextDecoder();
      const summaryContent = decoder.decode(files!["backup-summary.json"]);
      const summary = JSON.parse(summaryContent);

      expect(summary.stats.totalContacts).toBe(0);
      expect(summary.stats.totalMessages).toBe(0);
      expect(summary.stats.dateRange.start).toBeNull();
      expect(summary.stats.dateRange.end).toBeNull();
    });

    it("should include README with proper content", async () => {
      // Arrange
      mockSql.mockImplementation(() => ({
        execute: mock(() => Promise.resolve({ rows: [] })),
      }));

      // Act
      await exportFullBackup("company-123");

      // Assert
      expect(mockZip).toHaveBeenCalled();
      const files = getLastCapturedFiles();
      expect(files).not.toBeNull();

      const decoder = new TextDecoder();
      const readmeContent = decoder.decode(files!["README.txt"]);

      expect(readmeContent).toContain("WhatsApp Web Backup");
      expect(readmeContent).toContain("Backup Contents");
      expect(readmeContent).toContain("contacts.json");
      expect(readmeContent).toContain("messages.json");
      expect(readmeContent).toContain("Statistics");
    });

    it("should include date filter info in README when filters applied", async () => {
      // Arrange
      mockSql.mockImplementation(() => ({
        execute: mock(() => Promise.resolve({ rows: [] })),
      }));

      // Act
      await exportFullBackup("company-123", {
        startDate: new Date("2024-01-01"),
        endDate: new Date("2024-01-31"),
      });

      // Assert
      expect(mockZip).toHaveBeenCalled();
      const files = getLastCapturedFiles();
      expect(files).not.toBeNull();

      const decoder = new TextDecoder();
      const readmeContent = decoder.decode(files!["README.txt"]);

      expect(readmeContent).toContain("Filters Applied");
      expect(readmeContent).toContain("Start Date: 2024-01-01");
      expect(readmeContent).toContain("End Date: 2024-01-31");
    });
  });
});
