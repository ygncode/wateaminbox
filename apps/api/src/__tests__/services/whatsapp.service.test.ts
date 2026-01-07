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
import {
  createMockWhatsAppConnection,
  createMockContact,
  createMutableMockQueryBuilder,
  resetMockQueryBuilder,
} from "../mocks";

// Mock query builder - using centralized mock utilities
let mockQueryBuilder = createMutableMockQueryBuilder();

// Mock NATS publish functions
const mockPublishSpawnCommand = mock(async () => {});
const mockPublishKillCommand = mock(async () => {});
const mockPublishSendMessage = mock(async () => {});

mock.module("../../lib/nats/index.js", () => ({
  buildCommandSubject: (companyId: string, connectionId: string) =>
    `WHATSAPP.commands.${companyId}.${connectionId}`,
  publishSpawnCommand: mockPublishSpawnCommand,
  publishKillCommand: mockPublishKillCommand,
  publishSendMessage: mockPublishSendMessage,
  // Provide stub implementations for other exports to prevent module loading errors
  publishPostStatus: mock(async () => {}),
  publishGroupPromoteAdmin: mock(async () => {}),
  publishGroupDemoteAdmin: mock(async () => {}),
  publishGroupRemoveParticipant: mock(async () => {}),
  publishGroupUpdateSettings: mock(async () => {}),
  publishSyncLabels: mock(async () => {}),
  publishApplyLabel: mock(async () => {}),
  publishRemoveLabel: mock(async () => {}),
  publishSyncCatalogs: mock(async () => {}),
  publishSyncCatalogProducts: mock(async () => {}),
  publishSendReaction: mock(async () => {}),
  publishCommand: mock(async () => {}),
  getNatsConnection: mock(async () => ({ status: 'ok' })),
  getJetStreamClient: mock(async () => ({ status: 'ok' })),
  subscribe: mock(async () => {}),
  subscribeToCompanyEvents: mock(async () => {}),
  subscribeToConnectionEvents: mock(async () => {}),
  subscribeToAllEvents: mock(async () => {}),
  closeNatsConnection: mock(async () => {}),
  isNatsConnected: mock(() => true),
  request: mock(async () => ({})),
  NATS_SUBJECTS: {
    SPAWN: 'whatsapp.spawn',
    KILL: 'whatsapp.kill',
    SEND_MESSAGE: 'whatsapp.send-message',
    POST_STATUS: 'whatsapp.post-status',
    GROUP_PROMOTE_ADMIN: 'whatsapp.group.promote-admin',
    GROUP_DEMOTE_ADMIN: 'whatsapp.group.demote-admin',
    GROUP_REMOVE_PARTICIPANT: 'whatsapp.group.remove-participant',
    GROUP_UPDATE_SETTINGS: 'whatsapp.group.update-settings',
    SYNC_LABELS: 'whatsapp.sync-labels',
    APPLY_LABEL: 'whatsapp.apply-label',
    REMOVE_LABEL: 'whatsapp.remove-label',
    SEND_REACTION: 'whatsapp.send-reaction',
    SYNC_CATALOGS: 'whatsapp.sync-catalogs',
    SYNC_CATALOG_PRODUCTS: 'whatsapp.sync-catalog-products',
    QR_CODE: 'whatsapp.events.qr',
    CONNECTION_UPDATE: 'whatsapp.events.connection',
    MESSAGE: 'whatsapp.events.message',
    RECEIPT: 'whatsapp.events.receipt',
    SEND_CONFIRMATION: 'whatsapp.events.send-confirmation',
    STATUS_UPDATE: 'whatsapp.events.status',
    CONTACT_UPDATE: 'whatsapp.events.contact',
    PRESENCE: 'whatsapp.events.presence',
    TYPING: 'whatsapp.events.typing',
    MESSAGE_REVOKE: 'whatsapp.events.message-revoke',
    REACTION: 'whatsapp.events.reaction',
    PROFILE_PICTURE: 'whatsapp.events.profile-picture',
    LABELS: 'whatsapp.events.labels',
    CATALOGS: 'whatsapp.events.catalogs',
    CATALOG_PRODUCTS: 'whatsapp.events.catalog-products',
  },
}));

// Mock env
const TEST_DATABASE_URL = "postgres://test:test@localhost:5432/test";
mock.module("../../lib/env.js", () => ({
  env: {
    DATABASE_URL: TEST_DATABASE_URL,
  },
}));

// Mock the shared database from @whatsapp-web/database
// This is used by getMaxConnections() to check company limits
let mockDbQueryBuilder: Record<string, unknown> = {};

// Create the db mock object that we'll reuse
const mockDb = {
  selectFrom: mock(() => mockDbQueryBuilder),
};

function resetMockDbQueryBuilder(returnValue: unknown = undefined) {
  mockDbQueryBuilder = {
    selectFrom: mock(() => mockDbQueryBuilder),
    select: mock(() => mockDbQueryBuilder),
    where: mock(() => mockDbQueryBuilder),
    executeTakeFirst: mock(() => Promise.resolve(returnValue)),
  };
  // Update the mock to return the new query builder
  mockDb.selectFrom = mock(() => mockDbQueryBuilder);
}
resetMockDbQueryBuilder({ max_whatsapp_connections: 5 });

mock.module("@whatsapp-web/database", () => ({
  db: mockDb,
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
    resetMockQueryBuilder(mockQueryBuilder);
    resetMockDbQueryBuilder({ max_whatsapp_connections: 5 });
    mockPublishSpawnCommand.mockClear();
    mockPublishKillCommand.mockClear();
    mockPublishSendMessage.mockClear();
  });

  describe("spawnConnection", () => {
    it("should create new pending connection", async () => {
      // Arrange
      const mockTenantDb = createMockTenantDb();
      // Mock count query returns 0 active connections
      const countResult = { count: 0 };
      const countQueryBuilder = {
        select: mock(() => countQueryBuilder),
        where: mock(() => countQueryBuilder),
        executeTakeFirst: mock(() => Promise.resolve(countResult)),
      };
      mockTenantDb.selectFrom = mock(() => countQueryBuilder);

      const insertQueryBuilder = {
        values: mock(() => insertQueryBuilder),
        execute: mock(() => Promise.resolve()),
      };
      mockTenantDb.insertInto = mock(() => insertQueryBuilder);

      // Act
      const result = await spawnConnection(mockTenantDb as never, "company-123", "user-123");

      // Assert
      expect(result.connectionId).toBeDefined();
      expect(result.wsUrl).toContain("company=company-123");
      expect(result.wsUrl).toContain(`connection=${result.connectionId}`);
      expect(mockPublishSpawnCommand).toHaveBeenCalledWith("company-123", result.connectionId, TEST_DATABASE_URL);
    });

    it("should throw error if max connections exceeded", async () => {
      // Arrange
      const mockTenantDb = createMockTenantDb();
      // Mock count query returns max connections reached (5)
      const countResult = { count: 5 };
      const countQueryBuilder = {
        select: mock(() => countQueryBuilder),
        where: mock(() => countQueryBuilder),
        executeTakeFirst: mock(() => Promise.resolve(countResult)),
      };
      mockTenantDb.selectFrom = mock(() => countQueryBuilder);

      // Act & Assert
      await expect(spawnConnection(mockTenantDb as never, "company-123", "user-123")).rejects.toThrow("Maximum WhatsApp connections exceeded");
    });

    it("should allow connection when under limit", async () => {
      // Arrange
      const mockTenantDb = createMockTenantDb();
      // Mock count query returns 2 active connections (under limit of 5)
      const countResult = { count: 2 };
      const countQueryBuilder = {
        select: mock(() => countQueryBuilder),
        where: mock(() => countQueryBuilder),
        executeTakeFirst: mock(() => Promise.resolve(countResult)),
      };
      mockTenantDb.selectFrom = mock(() => countQueryBuilder);

      const insertQueryBuilder = {
        values: mock(() => insertQueryBuilder),
        execute: mock(() => Promise.resolve()),
      };
      mockTenantDb.insertInto = mock(() => insertQueryBuilder);

      // Act
      const result = await spawnConnection(mockTenantDb as never, "company-123", "user-123");

      // Assert
      expect(result.connectionId).toBeDefined();
      expect(mockPublishSpawnCommand).toHaveBeenCalled();
    });
  });

  describe("killConnection", () => {
    it("should disconnect active connection", async () => {
      // Arrange
      const mockTenantDb = createMockTenantDb();
      const connectionId = "conn-123";
      const activeConnection = createMockWhatsAppConnection({ id: connectionId, status: "connected" });
      resetMockQueryBuilder(mockQueryBuilder, activeConnection);
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);
      mockTenantDb.updateTable = mock(() => ({
        ...mockQueryBuilder,
        set: mock(() => mockQueryBuilder),
        where: mock(() => mockQueryBuilder),
        execute: mock(() => Promise.resolve()),
      }));

      // Act
      await killConnection(mockTenantDb as never, "company-123", connectionId);

      // Assert
      expect(mockPublishKillCommand).toHaveBeenCalledWith("company-123", connectionId);
    });

    it("should throw error if no connection exists", async () => {
      // Arrange
      const mockTenantDb = createMockTenantDb();
      resetMockQueryBuilder(mockQueryBuilder, undefined);
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      // Act & Assert
      await expect(killConnection(mockTenantDb as never, "company-123", "non-existent")).rejects.toThrow(ConnectionNotFoundError);
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
      resetMockQueryBuilder(mockQueryBuilder, connection);
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
      resetMockQueryBuilder(mockQueryBuilder, undefined);
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
      resetMockQueryBuilder(mockQueryBuilder, connection);
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
      resetMockQueryBuilder(mockQueryBuilder, connection);
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
      resetMockQueryBuilder(mockQueryBuilder, connection);
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
      const connectionId = "conn-123";
      const activeConnection = createMockWhatsAppConnection({ id: connectionId, status: "connected" });
      const existingContact = createMockContact();

      let selectCount = 0;
      mockTenantDb.selectFrom = mock(() => {
        selectCount++;
        if (selectCount === 1) {
          // Connection check
          resetMockQueryBuilder(mockQueryBuilder, activeConnection);
          return mockQueryBuilder;
        }
        // Contact lookup
        resetMockQueryBuilder(mockQueryBuilder, existingContact);
        return mockQueryBuilder;
      });

      mockTenantDb.insertInto = mock(() => ({
        ...mockQueryBuilder,
        values: mock(() => ({ execute: mock(() => Promise.resolve()) })),
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
      // sendMessage now uses connection.id, not just companyId
      // pendingMessageId (result.messageId) is passed to allow worker to update correct record
      expect(mockPublishSendMessage).toHaveBeenCalledWith(
        "company-123",
        connectionId,
        input.jid,
        input.content,
        input.messageType,
        "user-123",
        result.messageId, // pendingMessageId
        undefined // mediaUrl
      );
    });

    it("should throw error when not connected", async () => {
      // Arrange
      const mockTenantDb = createMockTenantDb();
      resetMockQueryBuilder(mockQueryBuilder, undefined); // No active connection
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
          resetMockQueryBuilder(mockQueryBuilder, activeConnection);
          return mockQueryBuilder;
        }
        // Contact lookup - not found
        resetMockQueryBuilder(mockQueryBuilder, undefined);
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
      const connectionId = "conn-123";
      const activeConnection = createMockWhatsAppConnection({ id: connectionId, status: "connected" });
      const existingContact = createMockContact();

      let selectCount = 0;
      mockTenantDb.selectFrom = mock(() => {
        selectCount++;
        if (selectCount === 1) {
          resetMockQueryBuilder(mockQueryBuilder, activeConnection);
          return mockQueryBuilder;
        }
        resetMockQueryBuilder(mockQueryBuilder, existingContact);
        return mockQueryBuilder;
      });

      mockTenantDb.insertInto = mock(() => ({
        ...mockQueryBuilder,
        values: mock(() => ({ execute: mock(() => Promise.resolve()) })),
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
      // pendingMessageId (result.messageId) is passed to allow worker to update correct record
      expect(mockPublishSendMessage).toHaveBeenCalledWith(
        "company-123",
        connectionId,
        input.jid,
        input.content,
        input.messageType,
        "user-123",
        result.messageId, // pendingMessageId
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
          resetMockQueryBuilder(mockQueryBuilder, activeConnection);
          return mockQueryBuilder;
        }
        // Contact lookup - not found, will create
        resetMockQueryBuilder(mockQueryBuilder, undefined);
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
      resetMockQueryBuilder(mockQueryBuilder, pendingConnection);
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
      resetMockQueryBuilder(mockQueryBuilder, undefined);
      mockTenantDb.selectFrom = mock(() => mockQueryBuilder);

      // Act & Assert - should not throw
      await expect(updateConnectionStatus(mockTenantDb as never, "connected")).resolves.toBeUndefined();
    });

    it("should set connected_at when status is connected", async () => {
      // Arrange
      const mockTenantDb = createMockTenantDb();
      const pendingConnection = createMockWhatsAppConnection({ status: "pending" });
      resetMockQueryBuilder(mockQueryBuilder, pendingConnection);
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
      resetMockQueryBuilder(mockQueryBuilder, activeConnection);
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
      resetMockQueryBuilder(mockQueryBuilder, undefined);
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
      resetMockQueryBuilder(mockQueryBuilder, activeConnection);
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
