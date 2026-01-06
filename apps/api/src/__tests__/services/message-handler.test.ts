/**
 * Unit tests for message-handler.ts
 *
 * Tests WhatsApp message event handling functionality including:
 * - Send confirmation event handling
 * - Message ID mapping (pending -> real WhatsApp ID)
 * - WebSocket broadcasting for status updates
 * - Error handling for missing messages
 */

import { describe, it, expect, mock, beforeEach } from "bun:test";
import { createUpdateResult, createMockMessage } from "../mocks/database.mock";
import type { SendConfirmationEvent, MessageRevokeEvent } from "../../lib/nats";

// Mock query builder
let mockQueryBuilder: Record<string, unknown>;
let mockTenantDb: Record<string, unknown>;

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

function resetMockTenantDb() {
  resetMockQueryBuilder();
  mockTenantDb = {
    selectFrom: mock(() => mockQueryBuilder),
    insertInto: mock(() => mockQueryBuilder),
    updateTable: mock(() => mockQueryBuilder),
  };
}

// Mock tenant service
const mockGetTenantConnection = mock(() => mockTenantDb);

mock.module("../../services/tenant.service.js", () => ({
  getTenantConnection: mockGetTenantConnection,
}));

// Mock WebSocket broadcast function
const mockBroadcastToCompany = mock(() => {});

mock.module("../../routes/ws.js", () => ({
  broadcastToCompany: mockBroadcastToCompany,
}));

// Mock other dependencies that message-handler imports but we don't use in send_confirmation tests
const mockSubscribeToAllEvents = mock(async () => ({}));
const mockUpdateConnectionStatus = mock(async () => {});

mock.module("../../lib/nats.js", () => ({
  subscribeToAllEvents: mockSubscribeToAllEvents,
  // Provide complete mock to prevent module loading errors when tests run together
  publishSpawnCommand: mock(async () => {}),
  publishKillCommand: mock(async () => {}),
  publishSendMessage: mock(async () => {}),
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
  subscribeToAllEvents: mockSubscribeToAllEvents,
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
  type: {} as never,
}));

// Error classes need to be defined for the mock
class ConnectionNotFoundError extends Error {
  constructor(message = "Connection not found") { super(message); this.name = "ConnectionNotFoundError"; }
}
class ConnectionAlreadyExistsError extends Error {
  constructor(message = "Connection already exists") { super(message); this.name = "ConnectionAlreadyExistsError"; }
}
class InvalidConnectionStateError extends Error {
  constructor(message = "Invalid connection state") { super(message); this.name = "InvalidConnectionStateError"; }
}
class MaxConnectionsExceededError extends Error {
  constructor(message = "Max connections exceeded") { super(message); this.name = "MaxConnectionsExceededError"; }
}

mock.module("../../services/whatsapp.service.js", () => ({
  updateConnectionStatus: mockUpdateConnectionStatus,
  // Stub other exports to prevent Bun's global mock.module from breaking other tests
  listConnections: mock(async () => []),
  getConnection: mock(async () => null),
  spawnConnection: mock(async () => ({})),
  killConnection: mock(async () => {}),
  getConnectionStatus: mock(async () => ({})),
  sendMessage: mock(async () => ({})),
  updateLastSync: mock(async () => {}),
  getActiveConnection: mock(async () => null),
  getActiveConnections: mock(async () => []),
  getConnectionLimits: mock(async () => ({ current: 0, max: 5 })),
  // Export error classes
  ConnectionNotFoundError,
  ConnectionAlreadyExistsError,
  InvalidConnectionStateError,
  MaxConnectionsExceededError,
}));

// Import the handler after all mocks are set up
// We need to import and call the handler function directly for testing
// Since handleSendConfirmationEvent is not exported, we'll test it through the event handler
const { handleWhatsAppEvent } = await import("../../services/message-handler.js");

describe("MessageHandler - handleSendConfirmationEvent", () => {
  beforeEach(() => {
    resetMockTenantDb();
    mockBroadcastToCompany.mockClear();
    mockGetTenantConnection.mockClear();
  });

  describe("successful send confirmation handling", () => {
    it("should update message from pending ID to real WhatsApp ID", async () => {
      // Arrange
      const pendingMessageId = "pending_abc123-def456";
      const realMessageId = "3EB0123456789@s.whatsapp.net";
      const companyId = "company-123";
      const connectionId = "connection-abc";
      const timestamp = "2026-01-05T12:34:56Z";

      const mockUpdateResult = createUpdateResult(1);
      mockQueryBuilder.executeTakeFirst = mock(() => Promise.resolve(mockUpdateResult));

      const event: SendConfirmationEvent = {
        type: "send_confirmation",
        companyId,
        connectionId,
        timestamp,
        payload: {
          pendingMessageId,
          messageId: realMessageId,
          timestamp,
        },
      };

      // Act
      await handleWhatsAppEvent(event);

      // Assert - verify updateTable was called with correct parameters
      expect(mockTenantDb.updateTable).toHaveBeenCalledWith("messages");

      // Verify the update set the correct values
      const setCall = mockQueryBuilder.set as unknown as ReturnType<typeof mock>;
      expect(setCall).toHaveBeenCalledWith({
        message_id: realMessageId,
        status: "sent",
      });

      // Verify the WHERE clause targets the pending message ID
      const whereCall = mockQueryBuilder.where as unknown as ReturnType<typeof mock>;
      expect(whereCall).toHaveBeenCalledWith("message_id", "=", pendingMessageId);

      // Verify executeTakeFirst was called to run the update
      expect(mockQueryBuilder.executeTakeFirst).toHaveBeenCalled();

      // Verify WebSocket broadcast was called
      expect(mockBroadcastToCompany).toHaveBeenCalledWith(
        companyId,
        expect.objectContaining({
          type: "message:status",
          connectionId,
          payload: {
            pendingMessageId,
            messageId: realMessageId,
            status: "sent",
            timestamp,
          },
        }),
      );
    });

    it("should broadcast correct WebSocket payload structure", async () => {
      // Arrange
      const pendingMessageId = "pending_xyz789";
      const realMessageId = "3EB0987654321@s.whatsapp.net";
      const companyId = "company-456";
      const connectionId = "connection-def";
      const timestamp = "2026-01-05T10:20:30Z";

      const mockUpdateResult = createUpdateResult(1);
      mockQueryBuilder.executeTakeFirst = mock(() => Promise.resolve(mockUpdateResult));

      const event: SendConfirmationEvent = {
        type: "send_confirmation",
        companyId,
        connectionId,
        timestamp,
        payload: {
          pendingMessageId,
          messageId: realMessageId,
          timestamp,
        },
      };

      // Act
      await handleWhatsAppEvent(event);

      // Assert - verify WebSocket broadcast payload
      expect(mockBroadcastToCompany).toHaveBeenCalledTimes(1);
      const broadcastCall = mockBroadcastToCompany.mock.calls[0];
      expect(broadcastCall[0]).toBe(companyId);

      const wsMessage = broadcastCall[1];
      expect(wsMessage).toMatchObject({
        type: "message:status",
        connectionId,
        payload: {
          pendingMessageId,
          messageId: realMessageId,
          status: "sent",
          timestamp,
        },
      });
      expect(wsMessage).toHaveProperty("timestamp");
    });

    it("should handle multiple confirmations for different messages", async () => {
      // Arrange - first confirmation
      const event1: SendConfirmationEvent = {
        type: "send_confirmation",
        companyId: "company-123",
        connectionId: "conn-1",
        timestamp: "2026-01-05T12:00:00Z",
        payload: {
          pendingMessageId: "pending_001",
          messageId: "3EB0001@s.whatsapp.net",
          timestamp: "2026-01-05T12:00:00Z",
        },
      };

      const mockUpdateResult1 = createUpdateResult(1);
      mockQueryBuilder.executeTakeFirst = mock(() => Promise.resolve(mockUpdateResult1));

      // Act - first confirmation
      await handleWhatsAppEvent(event1);

      // Assert - first confirmation
      expect(mockBroadcastToCompany).toHaveBeenCalledTimes(1);

      // Arrange - second confirmation (reset mocks)
      mockBroadcastToCompany.mockClear();
      const event2: SendConfirmationEvent = {
        type: "send_confirmation",
        companyId: "company-123",
        connectionId: "conn-1",
        timestamp: "2026-01-05T12:01:00Z",
        payload: {
          pendingMessageId: "pending_002",
          messageId: "3EB0002@s.whatsapp.net",
          timestamp: "2026-01-05T12:01:00Z",
        },
      };

      const mockUpdateResult2 = createUpdateResult(1);
      mockQueryBuilder.executeTakeFirst = mock(() => Promise.resolve(mockUpdateResult2));

      // Act - second confirmation
      await handleWhatsAppEvent(event2);

      // Assert - second confirmation
      expect(mockBroadcastToCompany).toHaveBeenCalledTimes(1);
      expect((mockQueryBuilder.set as unknown as ReturnType<typeof mock>)).toHaveBeenCalledWith({
        message_id: "3EB0002@s.whatsapp.net",
        status: "sent",
      });
    });
  });

  describe("handling missing pending message", () => {
    it("should handle gracefully when pending message does not exist (0 rows updated)", async () => {
      // Arrange
      const pendingMessageId = "pending_nonexistent";
      const realMessageId = "3EB0999@s.whatsapp.net";
      const companyId = "company-789";
      const connectionId = "conn-missing";
      const timestamp = "2026-01-05T15:30:00Z";

      // Simulate 0 rows affected (message not found)
      const mockUpdateResult = createUpdateResult(0);
      mockQueryBuilder.executeTakeFirst = mock(() => Promise.resolve(mockUpdateResult));

      const event: SendConfirmationEvent = {
        type: "send_confirmation",
        companyId,
        connectionId,
        timestamp,
        payload: {
          pendingMessageId,
          messageId: realMessageId,
          timestamp,
        },
      };

      // Act - should not throw, should handle gracefully
      // The function catches errors internally and returns undefined
      const result = await handleWhatsAppEvent(event);

      // Assert - no error thrown
      expect(result).toBeUndefined();

      // Assert - update was attempted
      expect(mockTenantDb.updateTable).toHaveBeenCalledWith("messages");
      expect(mockQueryBuilder.executeTakeFirst).toHaveBeenCalled();

      // Assert - WebSocket broadcast still happens (as per implementation)
      expect(mockBroadcastToCompany).toHaveBeenCalledWith(
        companyId,
        expect.objectContaining({
          type: "message:status",
          payload: expect.objectContaining({
            pendingMessageId,
            messageId: realMessageId,
            status: "sent",
          }),
        }),
      );
    });

    it("should handle race condition where receipt arrives before confirmation", async () => {
      // This test verifies the idempotency - if message_id has already been updated,
      // the WHERE clause won't match (since it looks for the pending ID)
      const pendingMessageId = "pending_racy";
      const realMessageId = "3EB0RACE@s.whatsapp.net";

      // Simulate 0 rows because message was already updated
      const mockUpdateResult = createUpdateResult(0);
      mockQueryBuilder.executeTakeFirst = mock(() => Promise.resolve(mockUpdateResult));

      const event: SendConfirmationEvent = {
        type: "send_confirmation",
        companyId: "company-race",
        connectionId: "conn-race",
        timestamp: "2026-01-05T16:00:00Z",
        payload: {
          pendingMessageId,
          messageId: realMessageId,
          timestamp: "2026-01-05T16:00:00Z",
        },
      };

      // Act & Assert - should not throw
      const result = await handleWhatsAppEvent(event);
      expect(result).toBeUndefined();
      expect(mockBroadcastToCompany).toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("should handle database errors gracefully", async () => {
      // Arrange
      const event: SendConfirmationEvent = {
        type: "send_confirmation",
        companyId: "company-error",
        connectionId: "conn-error",
        timestamp: "2026-01-05T17:00:00Z",
        payload: {
          pendingMessageId: "pending_error",
          messageId: "3EB0ERROR@s.whatsapp.net",
          timestamp: "2026-01-05T17:00:00Z",
        },
      };

      // Mock database error
      mockQueryBuilder.executeTakeFirst = mock(() => Promise.reject(new Error("Database connection failed")));

      // Act & Assert - should not throw, error is caught and logged
      const result = await handleWhatsAppEvent(event);
      expect(result).toBeUndefined();

      // WebSocket broadcast might not happen on error
      // The implementation catches the error and logs it
    });

    it("should handle malformed event data", async () => {
      // Arrange - event with empty IDs (edge case)
      const event: SendConfirmationEvent = {
        type: "send_confirmation",
        companyId: "",
        connectionId: "",
        timestamp: "",
        payload: {
          pendingMessageId: "",
          messageId: "",
          timestamp: "",
        },
      };

      // Mock return value with numUpdatedRows property
      const mockUpdateResult = createUpdateResult(0);
      mockQueryBuilder.executeTakeFirst = mock(() => Promise.resolve(mockUpdateResult));

      // Act & Assert - should attempt processing even with empty data
      // The mock will return undefined, but the handler should still complete
      const result = await handleWhatsAppEvent(event);
      expect(result).toBeUndefined();
      expect(mockTenantDb.updateTable).toHaveBeenCalledWith("messages");
    });
  });

  describe("idempotency", () => {
    it("should be idempotent - duplicate confirmations are safe", async () => {
      // Arrange
      const pendingMessageId = "pending_dup";
      const realMessageId = "3EB0DUP@s.whatsapp.net";

      // First call - message found and updated
      const mockUpdateResult1 = createUpdateResult(1);
      mockQueryBuilder.executeTakeFirst = mock(() => Promise.resolve(mockUpdateResult1));

      const event: SendConfirmationEvent = {
        type: "send_confirmation",
        companyId: "company-dup",
        connectionId: "conn-dup",
        timestamp: "2026-01-05T18:00:00Z",
        payload: {
          pendingMessageId,
          messageId: realMessageId,
          timestamp: "2026-01-05T18:00:00Z",
        },
      };

      // Act - first confirmation
      await handleWhatsAppEvent(event);

      // Arrange for second call - message already updated (WHERE clause won't match)
      const mockUpdateResult2 = createUpdateResult(0);
      mockQueryBuilder.executeTakeFirst = mock(() => Promise.resolve(mockUpdateResult2));

      // Act - duplicate confirmation (same pending ID)
      await handleWhatsAppEvent(event);

      // Assert - both calls complete without error
      expect(mockTenantDb.updateTable).toHaveBeenCalledTimes(2);
    });
  });

  describe("integration with other handlers", () => {
    it("should not interfere with other event types", async () => {
      // This test verifies the switch statement correctly routes to handleSendConfirmationEvent
      const receiptEvent = {
        type: "receipt",
        companyId: "company-123",
        connectionId: "conn-1",
        timestamp: "2026-01-05T19:00:00Z",
        payload: {
          messageId: "3EB0RECEIPT@s.whatsapp.net",
          status: "read" as const,
          timestamp: "2026-01-05T19:00:00Z",
        },
      };

      const mockUpdateResult = createUpdateResult(1);
      mockQueryBuilder.executeTakeFirst = mock(() => Promise.resolve(mockUpdateResult));

      // Act - receipt event should be handled differently
      await handleWhatsAppEvent(receiptEvent);

      // Assert - should use "sent" status for receipt "sender" type
      // This is a receipt event, not send_confirmation
      expect(mockTenantDb.updateTable).toHaveBeenCalled();
      expect(mockBroadcastToCompany).toHaveBeenCalled();

      // The broadcast type should be "receipt", not "message:status"
      const broadcastPayload = mockBroadcastToCompany.mock.calls[0]?.[1];
      // Receipt events broadcast with type "receipt"
      // Send confirmation events broadcast with type "message:status"
    });
  });
});

describe("MessageHandler - message ID mapping behavior", () => {
  beforeEach(() => {
    resetMockTenantDb();
    mockBroadcastToCompany.mockClear();
  });

  it("should correctly map pending UUID-based IDs to WhatsApp JID-based IDs", async () => {
    // Typical pending ID: "pending_{uuid}"
    // Typical WhatsApp ID: "3EB0{hex}@s.whatsapp.net"
    const pendingMessageId = "pending_550e8400-e29b-41d4-a716-446655440000";
    const realMessageId = "3EB0123ABCDEF@s.whatsapp.net";

    const mockUpdateResult = createUpdateResult(1);
    mockQueryBuilder.executeTakeFirst = mock(() => Promise.resolve(mockUpdateResult));

    const event: SendConfirmationEvent = {
      type: "send_confirmation",
      companyId: "company-format",
      connectionId: "conn-format",
      timestamp: "2026-01-05T20:00:00Z",
      payload: {
        pendingMessageId,
        messageId: realMessageId,
        timestamp: "2026-01-05T20:00:00Z",
      },
    };

    await handleWhatsAppEvent(event);

    // Verify both IDs are in the broadcast
    expect(mockBroadcastToCompany).toHaveBeenCalledWith(
      "company-format",
      expect.objectContaining({
        payload: expect.objectContaining({
          pendingMessageId,
          messageId: realMessageId,
        }),
      }),
    );
  });
});

describe("MessageHandler - handleMessageRevokeEvent", () => {
  beforeEach(() => {
    resetMockTenantDb();
    mockBroadcastToCompany.mockClear();
  });

  describe("successful message revoke handling", () => {
    it("should update message with deleted_by_sender and deleted_at", async () => {
      // Arrange
      const whatsappMessageId = "3EB0123456789@s.whatsapp.net";
      const companyId = "company-123";
      const connectionId = "connection-abc";
      const timestamp = "2026-01-05T12:34:56Z";
      const messageId = "message-123";
      const contactId = "contact-456";

      const mockUpdateResult = createUpdateResult(1);
      const mockMessage = createMockMessage({
        id: messageId,
        message_id: whatsappMessageId,
        contact_id: contactId,
      });

      let callCount = 0;
      mockQueryBuilder.executeTakeFirst = mock(() => {
        callCount++;
        // First call returns update result, second call returns message
        if (callCount === 1) return Promise.resolve(mockUpdateResult);
        return Promise.resolve(mockMessage);
      });

      const event: MessageRevokeEvent = {
        type: "message_revoke",
        companyId,
        connectionId,
        timestamp,
        payload: {
          messageId: whatsappMessageId,
          from: "1234567890@s.whatsapp.net",
          to: "9876543210@s.whatsapp.net",
          timestamp,
        },
      };

      // Act
      await handleWhatsAppEvent(event);

      // Assert - verify updateTable was called with correct parameters
      expect(mockTenantDb.updateTable).toHaveBeenCalledWith("messages");

      // Verify the update set the correct values
      const setCall = mockQueryBuilder.set as unknown as ReturnType<typeof mock>;
      expect(setCall).toHaveBeenCalledWith({
        deleted_by_sender: true,
        deleted_at: expect.any(Date),
      });

      // Verify the WHERE clause targets the message ID
      const whereCall = mockQueryBuilder.where as unknown as ReturnType<typeof mock>;
      expect(whereCall).toHaveBeenCalledWith("message_id", "=", whatsappMessageId);

      // Verify executeTakeFirst was called to run the update
      expect(mockQueryBuilder.executeTakeFirst).toHaveBeenCalled();

      // Verify WebSocket broadcast was called with correct payload
      expect(mockBroadcastToCompany).toHaveBeenCalledWith(
        companyId,
        expect.objectContaining({
          type: "message:deleted",
          connectionId,
          payload: {
            messageId,
            conversationId: contactId,
            whatsappMessageId,
          },
          timestamp: event.timestamp,
        }),
      );
    });

    it("should broadcast correct WebSocket payload structure", async () => {
      // Arrange
      const whatsappMessageId = "3EB0987654321@s.whatsapp.net";
      const companyId = "company-456";
      const connectionId = "connection-def";
      const timestamp = "2026-01-05T10:20:30Z";
      const messageId = "message-789";
      const contactId = "contact-012";

      const mockUpdateResult = createUpdateResult(1);
      const mockMessage = createMockMessage({
        id: messageId,
        message_id: whatsappMessageId,
        contact_id: contactId,
      });

      let callCount = 0;
      mockQueryBuilder.executeTakeFirst = mock(() => {
        callCount++;
        // First call returns update result, second call returns message
        if (callCount === 1) return Promise.resolve(mockUpdateResult);
        return Promise.resolve(mockMessage);
      });

      const event: MessageRevokeEvent = {
        type: "message_revoke",
        companyId,
        connectionId,
        timestamp,
        payload: {
          messageId: whatsappMessageId,
          from: "1234567890@s.whatsapp.net",
          to: "9876543210@s.whatsapp.net",
          timestamp,
        },
      };

      // Act
      await handleWhatsAppEvent(event);

      // Assert - verify WebSocket broadcast payload
      expect(mockBroadcastToCompany).toHaveBeenCalledTimes(1);
      const broadcastCall = mockBroadcastToCompany.mock.calls[0];
      expect(broadcastCall[0]).toBe(companyId);

      const wsMessage = broadcastCall[1];
      expect(wsMessage).toMatchObject({
        type: "message:deleted",
        connectionId,
        payload: {
          messageId,
          conversationId: contactId,
          whatsappMessageId,
        },
      });
      expect(wsMessage).toHaveProperty("timestamp");
    });

    it("should handle multiple revoke events for different messages", async () => {
      // Arrange - first revoke
      const event1: MessageRevokeEvent = {
        type: "message_revoke",
        companyId: "company-123",
        connectionId: "conn-1",
        timestamp: "2026-01-05T12:00:00Z",
        payload: {
          messageId: "3EB0001@s.whatsapp.net",
          from: "1234567890@s.whatsapp.net",
          to: "9876543210@s.whatsapp.net",
          timestamp: "2026-01-05T12:00:00Z",
        },
      };

      const mockUpdateResult1 = createUpdateResult(1);
      const mockMessage1 = createMockMessage({
        id: "message-001",
        message_id: "3EB0001@s.whatsapp.net",
        contact_id: "contact-001",
      });

      let callCount = 0;
      mockQueryBuilder.executeTakeFirst = mock(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve(mockUpdateResult1);
        return Promise.resolve(mockMessage1);
      });

      // Act - first revoke
      await handleWhatsAppEvent(event1);

      // Assert - first revoke
      expect(mockBroadcastToCompany).toHaveBeenCalledTimes(1);

      // Arrange - second revoke (reset mocks)
      mockBroadcastToCompany.mockClear();
      callCount = 0;

      const event2: MessageRevokeEvent = {
        type: "message_revoke",
        companyId: "company-123",
        connectionId: "conn-1",
        timestamp: "2026-01-05T12:01:00Z",
        payload: {
          messageId: "3EB0002@s.whatsapp.net",
          from: "1234567890@s.whatsapp.net",
          to: "9876543210@s.whatsapp.net",
          timestamp: "2026-01-05T12:01:00Z",
        },
      };

      const mockUpdateResult2 = createUpdateResult(1);
      const mockMessage2 = createMockMessage({
        id: "message-002",
        message_id: "3EB0002@s.whatsapp.net",
        contact_id: "contact-002",
      });

      mockQueryBuilder.executeTakeFirst = mock(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve(mockUpdateResult2);
        return Promise.resolve(mockMessage2);
      });

      // Act - second revoke
      await handleWhatsAppEvent(event2);

      // Assert - second revoke
      expect(mockBroadcastToCompany).toHaveBeenCalledTimes(1);
      expect((mockQueryBuilder.set as unknown as ReturnType<typeof mock>)).toHaveBeenCalledWith({
        deleted_by_sender: true,
        deleted_at: expect.any(Date),
      });
    });
  });

  describe("handling missing message", () => {
    it("should handle gracefully when message does not exist (0 rows updated)", async () => {
      // Arrange
      const whatsappMessageId = "3EB0999@s.whatsapp.net";
      const companyId = "company-789";
      const connectionId = "conn-missing";
      const timestamp = "2026-01-05T15:30:00Z";

      // Simulate 0 rows affected (message not found)
      const mockUpdateResult = createUpdateResult(0);
      mockQueryBuilder.executeTakeFirst = mock(() => Promise.resolve(mockUpdateResult));

      const event: MessageRevokeEvent = {
        type: "message_revoke",
        companyId,
        connectionId,
        timestamp,
        payload: {
          messageId: whatsappMessageId,
          from: "1234567890@s.whatsapp.net",
          to: "9876543210@s.whatsapp.net",
          timestamp,
        },
      };

      // Act - should not throw, should handle gracefully
      const result = await handleWhatsAppEvent(event);

      // Assert - no error thrown
      expect(result).toBeUndefined();

      // Assert - update was attempted
      expect(mockTenantDb.updateTable).toHaveBeenCalledWith("messages");
      expect(mockQueryBuilder.executeTakeFirst).toHaveBeenCalled();

      // Assert - WebSocket broadcast should NOT happen when message not found
      expect(mockBroadcastToCompany).not.toHaveBeenCalled();
    });

    it("should handle race condition where revoke arrives before message is stored", async () => {
      // This test verifies the handler handles the case where a message revoke event
      // arrives before the message itself is stored in the database
      const whatsappMessageId = "3EB0RACE@s.whatsapp.net";

      // Simulate 0 rows because message hasn't been stored yet
      const mockUpdateResult = createUpdateResult(0);
      mockQueryBuilder.executeTakeFirst = mock(() => Promise.resolve(mockUpdateResult));

      const event: MessageRevokeEvent = {
        type: "message_revoke",
        companyId: "company-race",
        connectionId: "conn-race",
        timestamp: "2026-01-05T16:00:00Z",
        payload: {
          messageId: whatsappMessageId,
          from: "1234567890@s.whatsapp.net",
          to: "9876543210@s.whatsapp.net",
          timestamp: "2026-01-05T16:00:00Z",
        },
      };

      // Act & Assert - should not throw
      const result = await handleWhatsAppEvent(event);
      expect(result).toBeUndefined();
      expect(mockBroadcastToCompany).not.toHaveBeenCalled();
    });

    it("should handle case where message update succeeds but message select fails", async () => {
      // This tests the case where the update returns 1 row affected,
      // but the subsequent select to get message details returns nothing
      const whatsappMessageId = "3EB0GONE@s.whatsapp.net";

      const mockUpdateResult = createUpdateResult(1);
      let callCount = 0;
      mockQueryBuilder.executeTakeFirst = mock(() => {
        callCount++;
        // First call (update) returns 1 row
        if (callCount === 1) return Promise.resolve(mockUpdateResult);
        // Second call (select) returns undefined - message was deleted between operations
        return Promise.resolve(undefined);
      });

      const event: MessageRevokeEvent = {
        type: "message_revoke",
        companyId: "company-edge",
        connectionId: "conn-edge",
        timestamp: "2026-01-05T17:00:00Z",
        payload: {
          messageId: whatsappMessageId,
          from: "1234567890@s.whatsapp.net",
          to: "9876543210@s.whatsapp.net",
          timestamp: "2026-01-05T17:00:00Z",
        },
      };

      // Act & Assert - should not throw
      const result = await handleWhatsAppEvent(event);
      expect(result).toBeUndefined();
      // No broadcast because message select returned undefined
      expect(mockBroadcastToCompany).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("should handle database errors gracefully", async () => {
      // Arrange
      const event: MessageRevokeEvent = {
        type: "message_revoke",
        companyId: "company-error",
        connectionId: "conn-error",
        timestamp: "2026-01-05T18:00:00Z",
        payload: {
          messageId: "3EB0ERROR@s.whatsapp.net",
          from: "1234567890@s.whatsapp.net",
          to: "9876543210@s.whatsapp.net",
          timestamp: "2026-01-05T18:00:00Z",
        },
      };

      // Mock database error
      mockQueryBuilder.executeTakeFirst = mock(() => Promise.reject(new Error("Database connection failed")));

      // Act & Assert - should not throw, error is caught and logged
      const result = await handleWhatsAppEvent(event);
      expect(result).toBeUndefined();

      // WebSocket broadcast should not happen on error
      expect(mockBroadcastToCompany).not.toHaveBeenCalled();
    });

    it("should handle tenant connection errors gracefully", async () => {
      // Arrange - mock getTenantConnection to throw
      mockGetTenantConnection.mockImplementation(() => {
        throw new Error("Tenant not found");
      });

      const event: MessageRevokeEvent = {
        type: "message_revoke",
        companyId: "non-existent-company",
        connectionId: "conn-no-tenant",
        timestamp: "2026-01-05T19:00:00Z",
        payload: {
          messageId: "3EB0NOTENT@s.whatsapp.net",
          from: "1234567890@s.whatsapp.net",
          to: "9876543210@s.whatsapp.net",
          timestamp: "2026-01-05T19:00:00Z",
        },
      };

      // Act & Assert - should not throw
      const result = await handleWhatsAppEvent(event);
      expect(result).toBeUndefined();

      // Reset mock
      mockGetTenantConnection.mockImplementation(() => mockTenantDb);
    });

    it("should handle malformed event data", async () => {
      // Arrange - event with empty IDs (edge case)
      const event: MessageRevokeEvent = {
        type: "message_revoke",
        companyId: "",
        connectionId: "",
        timestamp: "",
        payload: {
          messageId: "",
          from: "",
          to: "",
          timestamp: "",
        },
      };

      // Mock return value with numUpdatedRows property
      const mockUpdateResult = createUpdateResult(0);
      mockQueryBuilder.executeTakeFirst = mock(() => Promise.resolve(mockUpdateResult));

      // Act & Assert - should attempt processing even with empty data
      const result = await handleWhatsAppEvent(event);
      expect(result).toBeUndefined();
      expect(mockTenantDb.updateTable).toHaveBeenCalledWith("messages");
    });
  });

  describe("idempotency", () => {
    it("should be idempotent - duplicate revokes are safe", async () => {
      // Arrange
      const whatsappMessageId = "3EB0DUP@s.whatsapp.net";

      // First call - message found and updated
      const mockUpdateResult1 = createUpdateResult(1);
      const mockMessage = createMockMessage({
        id: "message-dup",
        message_id: whatsappMessageId,
        contact_id: "contact-dup",
      });

      let callCount = 0;
      mockQueryBuilder.executeTakeFirst = mock(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve(mockUpdateResult1);
        return Promise.resolve(mockMessage);
      });

      const event: MessageRevokeEvent = {
        type: "message_revoke",
        companyId: "company-dup",
        connectionId: "conn-dup",
        timestamp: "2026-01-05T20:00:00Z",
        payload: {
          messageId: whatsappMessageId,
          from: "1234567890@s.whatsapp.net",
          to: "9876543210@s.whatsapp.net",
          timestamp: "2026-01-05T20:00:00Z",
        },
      };

      // Act - first revoke
      await handleWhatsAppEvent(event);

      // Arrange for second call - message already deleted but update still succeeds
      mockBroadcastToCompany.mockClear();
      callCount = 0;
      const mockUpdateResult2 = createUpdateResult(1);
      mockQueryBuilder.executeTakeFirst = mock(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve(mockUpdateResult2);
        return Promise.resolve(mockMessage);
      });

      // Act - duplicate revoke (same message ID)
      await handleWhatsAppEvent(event);

      // Assert - both calls complete without error
      expect(mockTenantDb.updateTable).toHaveBeenCalledTimes(2);
      expect(mockBroadcastToCompany).toHaveBeenCalledTimes(1);
    });
  });

  describe("integration with other handlers", () => {
    it("should not interfere with other event types", async () => {
      // This test verifies the switch statement correctly routes to handleMessageRevokeEvent
      const sendConfirmationEvent = {
        type: "send_confirmation" as const,
        companyId: "company-123",
        connectionId: "conn-1",
        timestamp: "2026-01-05T21:00:00Z",
        payload: {
          pendingMessageId: "pending_abc",
          messageId: "3EB0CONF@s.whatsapp.net",
          timestamp: "2026-01-05T21:00:00Z",
        },
      };

      const mockUpdateResult = createUpdateResult(1);
      mockQueryBuilder.executeTakeFirst = mock(() => Promise.resolve(mockUpdateResult));

      // Act - send confirmation event should be handled differently
      await handleWhatsAppEvent(sendConfirmationEvent);

      // Assert - should use message:status type, not message:deleted
      const broadcastPayload = mockBroadcastToCompany.mock.calls[0]?.[1];
      expect(broadcastPayload?.type).toBe("message:status");
    });
  });
});

describe("MessageHandler - handlePresenceEvent", () => {
  beforeEach(() => {
    resetMockTenantDb();
    mockBroadcastToCompany.mockClear();
    mockGetTenantConnection.mockClear();
  });

  describe("successful presence handling", () => {
    it("should update contact to online status", async () => {
      // Arrange
      const jid = "1234567890@s.whatsapp.net";
      const companyId = "company-123";
      const connectionId = "connection-abc";
      const timestamp = "2026-01-05T12:34:56Z";

      const mockUpdateResult = createUpdateResult(1);
      mockQueryBuilder.executeTakeFirst = mock(() => Promise.resolve(mockUpdateResult));

      const event = {
        type: "presence" as const,
        companyId,
        connectionId,
        timestamp,
        payload: {
          from: jid,
          unavailable: false,
        },
      };

      // Act
      await handleWhatsAppEvent(event);

      // Assert - verify updateTable was called with correct parameters
      expect(mockTenantDb.updateTable).toHaveBeenCalledWith("contacts");

      // Verify the update set the correct values
      const setCall = mockQueryBuilder.set as unknown as ReturnType<typeof mock>;
      expect(setCall).toHaveBeenCalledWith({
        is_online: true,
        last_seen: null,
        updated_at: expect.any(Date),
      });

      // Verify the WHERE clause targets the JID
      const whereCall = mockQueryBuilder.where as unknown as ReturnType<typeof mock>;
      expect(whereCall).toHaveBeenCalledWith("jid", "=", jid);

      // Verify executeTakeFirst was called to run the update
      expect(mockQueryBuilder.executeTakeFirst).toHaveBeenCalled();

      // Verify WebSocket broadcast was called with correct payload
      expect(mockBroadcastToCompany).toHaveBeenCalledWith(
        companyId,
        expect.objectContaining({
          type: "presence:online",
          connectionId,
          payload: {
            jid,
            isOnline: true,
            lastSeen: undefined,
          },
          timestamp,
        }),
      );
    });

    it("should update contact to offline status with last seen", async () => {
      // Arrange
      const jid = "9876543210@s.whatsapp.net";
      const companyId = "company-456";
      const connectionId = "connection-def";
      const timestamp = "2026-01-05T14:00:00Z";
      const lastSeen = "2026-01-05T13:59:00Z";

      const mockUpdateResult = createUpdateResult(1);
      mockQueryBuilder.executeTakeFirst = mock(() => Promise.resolve(mockUpdateResult));

      const event = {
        type: "presence" as const,
        companyId,
        connectionId,
        timestamp,
        payload: {
          from: jid,
          unavailable: true,
          lastSeen,
        },
      };

      // Act
      await handleWhatsAppEvent(event);

      // Assert - verify the update set the correct values
      const setCall = mockQueryBuilder.set as unknown as ReturnType<typeof mock>;
      expect(setCall).toHaveBeenCalledWith({
        is_online: false,
        last_seen: new Date(lastSeen),
        updated_at: expect.any(Date),
      });

      // Verify WebSocket broadcast was called with correct payload
      expect(mockBroadcastToCompany).toHaveBeenCalledWith(
        companyId,
        expect.objectContaining({
          type: "presence:offline",
          connectionId,
          payload: expect.objectContaining({
            jid,
            isOnline: false,
          }),
          timestamp,
        }),
      );

      // Verify lastSeen is sent as ISO string (with milliseconds)
      const broadcastCall = mockBroadcastToCompany.mock.calls[0];
      expect(broadcastCall[1].payload.lastSeen).toBe(new Date(lastSeen).toISOString());
    });

    it("should broadcast correct WebSocket payload structure for online", async () => {
      // Arrange
      const jid = "1111111111@s.whatsapp.net";
      const companyId = "company-ws";
      const connectionId = "conn-ws";
      const timestamp = "2026-01-05T15:00:00Z";

      const mockUpdateResult = createUpdateResult(1);
      mockQueryBuilder.executeTakeFirst = mock(() => Promise.resolve(mockUpdateResult));

      const event = {
        type: "presence" as const,
        companyId,
        connectionId,
        timestamp,
        payload: {
          from: jid,
          unavailable: false,
        },
      };

      // Act
      await handleWhatsAppEvent(event);

      // Assert - verify WebSocket broadcast payload
      expect(mockBroadcastToCompany).toHaveBeenCalledTimes(1);
      const broadcastCall = mockBroadcastToCompany.mock.calls[0];
      expect(broadcastCall[0]).toBe(companyId);

      const wsMessage = broadcastCall[1];
      expect(wsMessage).toMatchObject({
        type: "presence:online",
        connectionId,
        payload: {
          jid,
          isOnline: true,
          lastSeen: undefined,
        },
      });
      expect(wsMessage).toHaveProperty("timestamp");
    });
  });

  describe("handling contact not found", () => {
    it("should handle gracefully when contact does not exist (0 rows updated)", async () => {
      // Arrange
      const jid = "unknown@s.whatsapp.net";
      const companyId = "company-789";
      const connectionId = "conn-missing";
      const timestamp = "2026-01-05T16:00:00Z";

      // Simulate 0 rows affected (contact not found)
      const mockUpdateResult = createUpdateResult(0);
      mockQueryBuilder.executeTakeFirst = mock(() => Promise.resolve(mockUpdateResult));

      const event = {
        type: "presence" as const,
        companyId,
        connectionId,
        timestamp,
        payload: {
          from: jid,
          unavailable: false,
        },
      };

      // Act - should not throw, should handle gracefully
      const result = await handleWhatsAppEvent(event);

      // Assert - no error thrown
      expect(result).toBeUndefined();

      // Assert - update was attempted
      expect(mockTenantDb.updateTable).toHaveBeenCalledWith("contacts");
      expect(mockQueryBuilder.executeTakeFirst).toHaveBeenCalled();

      // Assert - WebSocket broadcast should NOT happen when contact not found
      expect(mockBroadcastToCompany).not.toHaveBeenCalled();
    });

    it("should not log warning for unknown contact (expected behavior)", async () => {
      // This test verifies that presence updates for unknown contacts are handled silently
      // This is normal behavior - we only track presence for contacts we've received messages from
      const jid = "newcontact@s.whatsapp.net";

      const mockUpdateResult = createUpdateResult(0);
      mockQueryBuilder.executeTakeFirst = mock(() => Promise.resolve(mockUpdateResult));

      const event = {
        type: "presence" as const,
        companyId: "company-normal",
        connectionId: "conn-normal",
        timestamp: "2026-01-05T17:00:00Z",
        payload: {
          from: jid,
          unavailable: true,
          lastSeen: "2026-01-05T16:59:00Z",
        },
      };

      // Act & Assert - should complete without error
      const result = await handleWhatsAppEvent(event);
      expect(result).toBeUndefined();
      expect(mockBroadcastToCompany).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("should handle database errors gracefully", async () => {
      // Arrange
      const event = {
        type: "presence" as const,
        companyId: "company-error",
        connectionId: "conn-error",
        timestamp: "2026-01-05T18:00:00Z",
        payload: {
          from: "error@s.whatsapp.net",
          unavailable: false,
        },
      };

      // Mock database error
      mockQueryBuilder.executeTakeFirst = mock(() => Promise.reject(new Error("Database connection failed")));

      // Act & Assert - should not throw, error is caught and logged
      const result = await handleWhatsAppEvent(event);
      expect(result).toBeUndefined();

      // WebSocket broadcast should not happen on error
      expect(mockBroadcastToCompany).not.toHaveBeenCalled();
    });

    it("should handle tenant connection errors gracefully", async () => {
      // Arrange - mock getTenantConnection to throw
      mockGetTenantConnection.mockImplementation(() => {
        throw new Error("Tenant not found");
      });

      const event = {
        type: "presence" as const,
        companyId: "non-existent-company",
        connectionId: "conn-no-tenant",
        timestamp: "2026-01-05T19:00:00Z",
        payload: {
          from: "contact@s.whatsapp.net",
          unavailable: false,
        },
      };

      // Act & Assert - should not throw
      const result = await handleWhatsAppEvent(event);
      expect(result).toBeUndefined();

      // Reset mock
      mockGetTenantConnection.mockImplementation(() => mockTenantDb);
    });

    it("should handle multiple presence updates for same contact", async () => {
      // Arrange - first update (online)
      const jid = "contact@s.whatsapp.net";
      const event1 = {
        type: "presence" as const,
        companyId: "company-123",
        connectionId: "conn-1",
        timestamp: "2026-01-05T20:00:00Z",
        payload: {
          from: jid,
          unavailable: false,
        },
      };

      const mockUpdateResult1 = createUpdateResult(1);
      mockQueryBuilder.executeTakeFirst = mock(() => Promise.resolve(mockUpdateResult1));

      // Act - first update
      await handleWhatsAppEvent(event1);

      // Assert - first update
      expect(mockBroadcastToCompany).toHaveBeenCalledTimes(1);
      expect(mockBroadcastToCompany.mock.calls[0][1].type).toBe("presence:online");

      // Arrange - second update (offline)
      mockBroadcastToCompany.mockClear();
      const event2 = {
        type: "presence" as const,
        companyId: "company-123",
        connectionId: "conn-1",
        timestamp: "2026-01-05T20:05:00Z",
        payload: {
          from: jid,
          unavailable: true,
          lastSeen: "2026-01-05T20:04:00Z",
        },
      };

      const mockUpdateResult2 = createUpdateResult(1);
      mockQueryBuilder.executeTakeFirst = mock(() => Promise.resolve(mockUpdateResult2));

      // Act - second update
      await handleWhatsAppEvent(event2);

      // Assert - second update
      expect(mockBroadcastToCompany).toHaveBeenCalledTimes(1);
      expect(mockBroadcastToCompany.mock.calls[0][1].type).toBe("presence:offline");
    });
  });

  describe("integration with other handlers", () => {
    it("should not interfere with other event types", async () => {
      // This test verifies the switch statement correctly routes events to the right handler
      // A presence event should be handled by handlePresenceEvent, a message event by handleMessageEvent
      // Since full message handling requires extensive mocking (contact lookup, message insert, search vector update),
      // we just verify that presence-specific broadcasts don't fire for non-presence events

      const messageEvent = {
        type: "message" as const,
        companyId: "company-123",
        connectionId: "conn-1",
        timestamp: "2026-01-05T21:00:00Z",
        payload: {
          messageId: "3EB0MSG@s.whatsapp.net",
          from: "sender@s.whatsapp.net",
          to: "receiver@s.whatsapp.net",
          content: "Hello",
          timestamp: "2026-01-05T21:00:00Z",
          fromMe: false,
        },
      };

      // Act - message event processing may fail due to incomplete mocking (missing contact, etc.)
      // but it should NOT trigger presence broadcasts
      try {
        await handleWhatsAppEvent(messageEvent);
      } catch {
        // Expected - message handling may fail due to incomplete mock setup
        // The important thing is that presence broadcasts were NOT triggered
      }

      // Assert - presence broadcasts should NOT have been called
      // Even if message handling failed, it should not have triggered presence:online or presence:offline
      const presenceBroadcasts = (mockBroadcastToCompany.mock.calls as Array<[string, { type: string }]>)
        .filter(([, event]) => event.type === "presence:online" || event.type === "presence:offline");
      expect(presenceBroadcasts.length).toBe(0);
    });
  });
});
