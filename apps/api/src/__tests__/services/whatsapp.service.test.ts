/**
 * Unit tests for whatsapp.service.ts
 *
 * Tests WhatsApp connection functionality including:
 * - Spawning connections
 * - Killing connections
 * - Getting connection status
 * - Sending messages
 * - Updating connection status
 */

import { describe, it, expect, mock, beforeEach } from "bun:test";
import { createMockWhatsAppConnection, createMockContact } from "../mocks";

// Mock query builder
let mockQueryBuilder: Record<string, unknown>;

function resetMockQueryBuilder(returnValue: unknown = undefined) {
  mockQueryBuilder = {
    selectFrom: mock(() => mockQueryBuilder),
    insertInto: mock(() => mockQueryBuilder),
    updateTable: mock(() => mockQueryBuilder),
    select: mock(() => mockQueryBuilder),
    selectAll: mock(() => mockQueryBuilder),
    where: mock(() => mockQueryBuilder),
    values: mock(() => mockQueryBuilder),
    set: mock(() => mockQueryBuilder),
    returning: mock(() => mockQueryBuilder),
    orderBy: mock(() => mockQueryBuilder),
    limit: mock(() => mockQueryBuilder),
    execute: mock(() => Promise.resolve([])),
    executeTakeFirst: mock(() => Promise.resolve(returnValue)),
  };
}

// Mock NATS publish functions
const mockPublishSpawnCommand = mock(async () => {});
const mockPublishKillCommand = mock(async () => {});
const mockPublishSendMessage = mock(async () => {});

mock.module("../../lib/nats.js", () => ({
  publishSpawnCommand: mockPublishSpawnCommand,
  publishKillCommand: mockPublishKillCommand,
  publishSendMessage: mockPublishSendMessage,
}));

// Mock env
const TEST_DATABASE_URL = "postgres://test:test@localhost:5432/test";
mock.module("../../lib/env.js", () => ({
  env: {
    DATABASE_URL: TEST_DATABASE_URL,
  },
}));

// Import the service after mocking
import {
  spawnConnection,
  killConnection,
  getConnectionStatus,
  sendMessage,
  updateConnectionStatus,
  updateLastSync,
  getActiveConnection,
  ConnectionNotFoundError,
  ConnectionAlreadyExistsError,
  InvalidConnectionStateError,
  type SendMessageInput,
} from "../../services/whatsapp.service";

// Create mock tenant database for each test
function createMockTenantDb() {
  return {
    selectFrom: mock(() => mockQueryBuilder),
    insertInto: mock(() => mockQueryBuilder),
    updateTable: mock(() => mockQueryBuilder),
  };
}

describe("WhatsAppService", () => {
  beforeEach(() => {
    resetMockQueryBuilder();
    mockPublishSpawnCommand.mockClear();
    mockPublishKillCommand.mockClear();
    mockPublishSendMessage.mockClear();
  });

  describe("spawnConnection", () => {
    it("should create new pending connection", async () => {
      // Arrange
      const mockTenantDb = createMockTenantDb();
      resetMockQueryBuilder(undefined); // No existing connection
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);
      mockTenantDb.insertInto = mock(() => ({
        ...mockQueryBuilder,
        execute: mock(() => Promise.resolve()),
      }));

      // Act
      const result = await spawnConnection(mockTenantDb as never, "company-123", "user-123");

      // Assert
      expect(result.connectionId).toBeDefined();
      expect(result.wsUrl).toContain("company=company-123");
      expect(mockPublishSpawnCommand).toHaveBeenCalledWith("company-123", TEST_DATABASE_URL);
    });

    it("should throw error if active connection exists", async () => {
      // Arrange
      const mockTenantDb = createMockTenantDb();
      const existingConnection = createMockWhatsAppConnection({ status: "connected" });
      resetMockQueryBuilder(existingConnection);
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      // Act & Assert
      await expect(spawnConnection(mockTenantDb as never, "company-123", "user-123")).rejects.toThrow(ConnectionAlreadyExistsError);
    });

    it("should return existing pending connection info", async () => {
      // Arrange
      const mockTenantDb = createMockTenantDb();
      const pendingConnection = createMockWhatsAppConnection({
        id: "existing-connection",
        status: "pending",
      });
      resetMockQueryBuilder(pendingConnection);
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      // Act
      const result = await spawnConnection(mockTenantDb as never, "company-123", "user-123");

      // Assert
      expect(result.connectionId).toBe("existing-connection");
      expect(mockPublishSpawnCommand).not.toHaveBeenCalled();
    });
  });

  describe("killConnection", () => {
    it("should disconnect active connection", async () => {
      // Arrange
      const mockTenantDb = createMockTenantDb();
      const activeConnection = createMockWhatsAppConnection({ status: "connected" });
      resetMockQueryBuilder(activeConnection);
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);
      mockTenantDb.updateTable = mock(() => ({
        ...mockQueryBuilder,
        execute: mock(() => Promise.resolve()),
      }));

      // Act
      await killConnection(mockTenantDb as never, "company-123");

      // Assert
      expect(mockPublishKillCommand).toHaveBeenCalledWith("company-123");
    });

    it("should throw error if no connection exists", async () => {
      // Arrange
      const mockTenantDb = createMockTenantDb();
      resetMockQueryBuilder(undefined);
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      // Act & Assert
      await expect(killConnection(mockTenantDb as never, "company-123")).rejects.toThrow(ConnectionNotFoundError);
    });
  });

  describe("getConnectionStatus", () => {
    it("should return status for connected connection", async () => {
      // Arrange
      const mockTenantDb = createMockTenantDb();
      const connection = createMockWhatsAppConnection({
        status: "connected",
        phone_number: "+1234567890",
        jid: "1234567890@s.whatsapp.net",
        connected_at: new Date(),
        last_sync_at: new Date(),
      });
      resetMockQueryBuilder(connection);
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      // Act
      const result = await getConnectionStatus(mockTenantDb as never);

      // Assert
      expect(result.status).toBe("connected");
      expect(result.phoneNumber).toBe("+1234567890");
      expect(result.jid).toBe("1234567890@s.whatsapp.net");
      expect(result.connectedAt).toBeDefined();
    });

    it("should return not_found status when no connection exists", async () => {
      // Arrange
      const mockTenantDb = createMockTenantDb();
      resetMockQueryBuilder(undefined);
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      // Act
      const result = await getConnectionStatus(mockTenantDb as never);

      // Assert
      expect(result.status).toBe("not_found");
    });

    it("should handle disconnected status", async () => {
      // Arrange
      const mockTenantDb = createMockTenantDb();
      const connection = createMockWhatsAppConnection({
        status: "disconnected",
        phone_number: "+1234567890",
      });
      resetMockQueryBuilder(connection);
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      // Act
      const result = await getConnectionStatus(mockTenantDb as never);

      // Assert
      expect(result.status).toBe("disconnected");
    });

    it("should handle banned status", async () => {
      // Arrange
      const mockTenantDb = createMockTenantDb();
      const connection = createMockWhatsAppConnection({ status: "banned" });
      resetMockQueryBuilder(connection);
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      // Act
      const result = await getConnectionStatus(mockTenantDb as never);

      // Assert
      expect(result.status).toBe("banned");
    });

    it("should handle null optional fields", async () => {
      // Arrange
      const mockTenantDb = createMockTenantDb();
      const connection = createMockWhatsAppConnection({
        status: "pending",
        phone_number: null,
        jid: null,
        connected_at: null,
        last_sync_at: null,
      });
      resetMockQueryBuilder(connection);
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      // Act
      const result = await getConnectionStatus(mockTenantDb as never);

      // Assert
      expect(result.status).toBe("pending");
      expect(result.phoneNumber).toBeUndefined();
      expect(result.jid).toBeUndefined();
    });
  });

  describe("sendMessage", () => {
    it("should send text message", async () => {
      // Arrange
      const mockTenantDb = createMockTenantDb();
      const activeConnection = createMockWhatsAppConnection({ status: "connected" });
      const existingContact = createMockContact();

      let selectCount = 0;
      mockTenantDb.selectFrom = mock(() => {
        selectCount++;
        if (selectCount === 1) {
          // Connection check
          resetMockQueryBuilder(activeConnection);
          return mockQueryBuilder;
        }
        // Contact lookup
        resetMockQueryBuilder(existingContact);
        return mockQueryBuilder;
      });

      mockTenantDb.insertInto = mock(() => ({
        ...mockQueryBuilder,
        execute: mock(() => Promise.resolve()),
      }));

      const input: SendMessageInput = {
        jid: "9876543210@s.whatsapp.net",
        content: "Hello!",
        messageType: "text",
      };

      // Act
      const result = await sendMessage(mockTenantDb as never, "company-123", "user-123", input);

      // Assert
      expect(result.messageId).toBeDefined();
      expect(mockPublishSendMessage).toHaveBeenCalledWith(
        "company-123",
        input.jid,
        input.content,
        input.messageType,
        "user-123",
        undefined
      );
    });

    it("should throw error when not connected", async () => {
      // Arrange
      const mockTenantDb = createMockTenantDb();
      resetMockQueryBuilder(undefined); // No active connection
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      const input: SendMessageInput = {
        jid: "9876543210@s.whatsapp.net",
        content: "Hello!",
        messageType: "text",
      };

      // Act & Assert
      await expect(sendMessage(mockTenantDb as never, "company-123", "user-123", input)).rejects.toThrow(InvalidConnectionStateError);
    });

    it("should create new contact if not exists", async () => {
      // Arrange
      const mockTenantDb = createMockTenantDb();
      const activeConnection = createMockWhatsAppConnection({ status: "connected" });

      let selectCount = 0;
      mockTenantDb.selectFrom = mock(() => {
        selectCount++;
        if (selectCount === 1) {
          // Connection check
          resetMockQueryBuilder(activeConnection);
          return mockQueryBuilder;
        }
        // Contact lookup - not found
        resetMockQueryBuilder(undefined);
        return mockQueryBuilder;
      });

      mockTenantDb.insertInto = mock(() => ({
        ...mockQueryBuilder,
        execute: mock(() => Promise.resolve()),
      }));

      const input: SendMessageInput = {
        jid: "9876543210@s.whatsapp.net",
        content: "Hello!",
        messageType: "text",
      };

      // Act
      const result = await sendMessage(mockTenantDb as never, "company-123", "user-123", input);

      // Assert
      expect(result.messageId).toBeDefined();
      // insertInto should be called for both contact and message
      expect(mockTenantDb.insertInto).toHaveBeenCalled();
    });

    it("should handle media message with URL", async () => {
      // Arrange
      const mockTenantDb = createMockTenantDb();
      const activeConnection = createMockWhatsAppConnection({ status: "connected" });
      const existingContact = createMockContact();

      let selectCount = 0;
      mockTenantDb.selectFrom = mock(() => {
        selectCount++;
        if (selectCount === 1) {
          resetMockQueryBuilder(activeConnection);
          return mockQueryBuilder;
        }
        resetMockQueryBuilder(existingContact);
        return mockQueryBuilder;
      });

      mockTenantDb.insertInto = mock(() => ({
        ...mockQueryBuilder,
        execute: mock(() => Promise.resolve()),
      }));

      const input: SendMessageInput = {
        jid: "9876543210@s.whatsapp.net",
        content: "Check this image",
        messageType: "image",
        mediaUrl: "https://example.com/image.jpg",
      };

      // Act
      const result = await sendMessage(mockTenantDb as never, "company-123", "user-123", input);

      // Assert
      expect(result.messageId).toBeDefined();
      expect(mockPublishSendMessage).toHaveBeenCalledWith(
        "company-123",
        input.jid,
        input.content,
        input.messageType,
        "user-123",
        input.mediaUrl
      );
    });

    it("should detect group JIDs", async () => {
      // Arrange
      const mockTenantDb = createMockTenantDb();
      const activeConnection = createMockWhatsAppConnection({ status: "connected" });

      let selectCount = 0;
      mockTenantDb.selectFrom = mock(() => {
        selectCount++;
        if (selectCount === 1) {
          resetMockQueryBuilder(activeConnection);
          return mockQueryBuilder;
        }
        // Contact lookup - not found, will create
        resetMockQueryBuilder(undefined);
        return mockQueryBuilder;
      });

      mockTenantDb.insertInto = mock(() => ({
        ...mockQueryBuilder,
        execute: mock(() => Promise.resolve()),
      }));

      const input: SendMessageInput = {
        jid: "123456789@g.us", // Group JID
        content: "Hello group!",
        messageType: "text",
      };

      // Act
      const result = await sendMessage(mockTenantDb as never, "company-123", "user-123", input);

      // Assert
      expect(result.messageId).toBeDefined();
    });
  });

  describe("updateConnectionStatus", () => {
    it("should update status to connected", async () => {
      // Arrange
      const mockTenantDb = createMockTenantDb();
      const pendingConnection = createMockWhatsAppConnection({ status: "pending" });
      resetMockQueryBuilder(pendingConnection);
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);
      mockTenantDb.updateTable = mock(() => ({
        ...mockQueryBuilder,
        execute: mock(() => Promise.resolve()),
      }));

      // Act
      await updateConnectionStatus(
        mockTenantDb as never,
        "connected",
        "+1234567890",
        "1234567890@s.whatsapp.net"
      );

      // Assert
      expect(mockTenantDb.updateTable).toHaveBeenCalled();
    });

    it("should handle no connection to update", async () => {
      // Arrange
      const mockTenantDb = createMockTenantDb();
      resetMockQueryBuilder(undefined);
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      // Act & Assert - should not throw
      await expect(updateConnectionStatus(mockTenantDb as never, "connected")).resolves.toBeUndefined();
    });

    it("should set connected_at when status is connected", async () => {
      // Arrange
      const mockTenantDb = createMockTenantDb();
      const pendingConnection = createMockWhatsAppConnection({ status: "pending" });
      resetMockQueryBuilder(pendingConnection);
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);
      mockTenantDb.updateTable = mock(() => ({
        ...mockQueryBuilder,
        execute: mock(() => Promise.resolve()),
      }));

      // Act
      await updateConnectionStatus(mockTenantDb as never, "connected");

      // Assert
      expect(mockTenantDb.updateTable).toHaveBeenCalled();
    });
  });

  describe("updateLastSync", () => {
    it("should update last sync timestamp", async () => {
      // Arrange
      const mockTenantDb = createMockTenantDb();
      mockTenantDb.updateTable = mock(() => ({
        ...mockQueryBuilder,
        execute: mock(() => Promise.resolve()),
      }));

      // Act
      await updateLastSync(mockTenantDb as never);

      // Assert
      expect(mockTenantDb.updateTable).toHaveBeenCalled();
    });
  });

  describe("getActiveConnection", () => {
    it("should return active connection", async () => {
      // Arrange
      const mockTenantDb = createMockTenantDb();
      const activeConnection = createMockWhatsAppConnection({ status: "connected" });
      resetMockQueryBuilder(activeConnection);
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      // Act
      const result = await getActiveConnection(mockTenantDb as never);

      // Assert
      expect(result).toBeDefined();
      expect(result?.status).toBe("connected");
    });

    it("should return null if no active connection", async () => {
      // Arrange
      const mockTenantDb = createMockTenantDb();
      resetMockQueryBuilder(undefined);
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      // Act
      const result = await getActiveConnection(mockTenantDb as never);

      // Assert
      expect(result).toBeNull();
    });

    it("should map database fields to interface", async () => {
      // Arrange
      const mockTenantDb = createMockTenantDb();
      const activeConnection = {
        id: "conn-123",
        phone_number: "+1234567890",
        jid: "1234567890@s.whatsapp.net",
        status: "connected" as const,
        connected_by: "user-123",
        connected_at: new Date(),
        last_sync_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      };
      resetMockQueryBuilder(activeConnection);
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      // Act
      const result = await getActiveConnection(mockTenantDb as never);

      // Assert
      expect(result?.id).toBe("conn-123");
      expect(result?.phoneNumber).toBe("+1234567890");
      expect(result?.jid).toBe("1234567890@s.whatsapp.net");
      expect(result?.status).toBe("connected");
      expect(result?.connectedBy).toBe("user-123");
    });
  });

  describe("Error Classes", () => {
    it("ConnectionNotFoundError should have correct properties", () => {
      const error = new ConnectionNotFoundError("company-123");
      expect(error.name).toBe("ConnectionNotFoundError");
      expect(error.message).toContain("company-123");
    });

    it("ConnectionAlreadyExistsError should have correct properties", () => {
      const error = new ConnectionAlreadyExistsError("company-123");
      expect(error.name).toBe("ConnectionAlreadyExistsError");
      expect(error.message).toContain("company-123");
    });

    it("InvalidConnectionStateError should have correct properties", () => {
      const error = new InvalidConnectionStateError("disconnected", "connected");
      expect(error.name).toBe("InvalidConnectionStateError");
      expect(error.message).toContain("disconnected");
      expect(error.message).toContain("connected");
    });
  });
});
