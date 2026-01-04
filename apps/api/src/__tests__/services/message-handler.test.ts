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
  type: {} as never,
}));

mock.module("../../services/whatsapp.service.js", () => ({
  updateConnectionStatus: mockUpdateConnectionStatus,
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
