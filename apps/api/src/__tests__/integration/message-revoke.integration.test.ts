/**
 * Integration tests for Message Revoke (Deletion) Handling
 *
 * Tests the complete end-to-end flow from WhatsApp message deletion to UI update:
 * - WhatsApp delete event → Go service → NATS event → API → DB update → WebSocket → Frontend UI update
 *
 * This integration test verifies:
 * 1. MessageRevokeEvent is properly received and handled
 * 2. Database updates the message with deleted_by_sender and deleted_at
 * 3. WebSocket broadcasts the message:deleted event
 * 4. Multiple tenant schemas handle revokes correctly
 * 5. Race conditions (revoke before message stored) are handled gracefully
 * 6. Error scenarios don't break the flow
 *
 * These tests use mocked tenant connections but simulate real multi-tenant scenarios
 * with proper database query chains and WebSocket broadcasts.
 */

import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test'
import {
  createMockMessage,
  createUpdateResult,
} from '../mocks'

// ============================================================================
// Type Definitions
// ============================================================================

interface MessageRevokeEvent {
  type: 'message_revoke'
  companyId: string
  connectionId: string
  timestamp: string
  payload: {
    messageId: string
    from: string
    to: string
    timestamp: string
  }
}

interface MessageDeletedPayload {
  messageId: string
  conversationId: string
  whatsappMessageId: string
}

// ============================================================================
// Mock Setup
// ============================================================================

// Track database state per tenant
const tenantMessageData = new Map<string, ReturnType<typeof createMockMessage>[]>()
const tenantDeletedMessages = new Map<string, Set<string>>()

// Track WebSocket broadcasts
const broadcastCalls = new Map<string, Array<{ type: string; payload: unknown }>>()

function resetMockState() {
  tenantMessageData.clear()
  tenantDeletedMessages.clear()
  broadcastCalls.clear()
}

// Mock broadcastToCompany - track calls per company
const mockBroadcastToCompany = mock((companyId: string, event: { type: string; payload: unknown; timestamp?: string }) => {
  if (!broadcastCalls.has(companyId)) {
    broadcastCalls.set(companyId, [])
  }
  broadcastCalls.get(companyId)?.push(event)
})

// Mock getTenantConnection - returns a mock database with proper query chains
const createMockTenantDb = (companyId: string) => {
  const messages = [...(tenantMessageData.get(companyId) || [])]
  const deletedIds = tenantDeletedMessages.get(companyId) || new Set<string>()

  return {
    selectFrom: mock((table: string) => {
      if (table !== 'messages') {
        const executeTakeFirst = mock(() => Promise.resolve(undefined))
        return {
          where: mock(() => ({ executeTakeFirst })),
        }
      }

      // For messages table - build proper query chain for selecting by message_id
      // Query: selectFrom('messages').select(['id', 'contact_id'])
      //        .where('message_id', '=', whatsappMessageId)
      //        .executeTakeFirst()

      const where = mock((_: string, __: string, whatsappMessageId: string) => {
        // Find the message
        const message = messages.find(m => m.message_id === whatsappMessageId)

        const executeTakeFirst = mock(() => Promise.resolve(message))

        return { executeTakeFirst }
      })

      const select = mock(() => ({ where }))

      return { select }
    }),

    updateTable: mock((table: string) => {
      if (table !== 'messages') {
        return {
          set: mock(() => ({
            where: mock(() => ({
              executeTakeFirst: mock(() => Promise.resolve({ numUpdatedRows: BigInt(0) })),
            })),
          })),
        }
      }

      // Track the WhatsApp message ID being updated
      let targetMessageId: string | null = null

      const where = mock((_: string, __: string, messageId: string) => {
        targetMessageId = messageId
        const messageIndex = messages.findIndex(m => m.message_id === messageId)

        const executeTakeFirst = mock(() => {
          if (messageIndex >= 0) {
            // Mark as deleted in our tracking
            if (!deletedIds.has(messageId)) {
              deletedIds.add(messageId)
              messages[messageIndex].deleted_by_sender = true
              messages[messageIndex].deleted_at = new Date()
            }
            return Promise.resolve({ numUpdatedRows: BigInt(1) })
          }
          return Promise.resolve({ numUpdatedRows: BigInt(0) })
        })

        return { executeTakeFirst }
      })

      const set = mock((values: { deleted_by_sender: boolean; deleted_at: Date }) => {
        // Verify the correct values are being set
        expect(values.deleted_by_sender).toBe(true)
        expect(values.deleted_at).toBeInstanceOf(Date)

        return { where }
      })

      return { set }
    }),

    destroy: mock(() => Promise.resolve()),
  }
}

const mockGetTenantConnection = mock((companyId: string) => {
  return createMockTenantDb(companyId)
})

// ============================================================================
// Module Mocks - Must be before imports
// ============================================================================

const databaseMock = {
  db: {
    selectFrom: mock(),
    insertInto: mock(),
    updateTable: mock(),
    deleteFrom: mock(),
  },
}

mock.module('@whatsapp-web/database', () => databaseMock)

mock.module('../../routes/ws.js', () => ({
  broadcastToCompany: mockBroadcastToCompany,
}))

// Mock other dependencies
const mockSubscribeToAllEvents = mock(async () => ({}))
const mockUpdateConnectionStatus = mock(async () => {})

mock.module('../../lib/nats.js', () => ({
  subscribeToAllEvents: mockSubscribeToAllEvents,
  type: {} as never,
}))

// Error classes need to be defined for the mock
class ConnectionNotFoundError extends Error {
  constructor(message = 'Connection not found') { super(message); this.name = 'ConnectionNotFoundError' }
}
class ConnectionAlreadyExistsError extends Error {
  constructor(message = 'Connection already exists') { super(message); this.name = 'ConnectionAlreadyExistsError' }
}
class InvalidConnectionStateError extends Error {
  constructor(message = 'Invalid connection state') { super(message); this.name = 'InvalidConnectionStateError' }
}
class MaxConnectionsExceededError extends Error {
  constructor(message = 'Max connections exceeded') { super(message); this.name = 'MaxConnectionsExceededError' }
}

mock.module('../../services/whatsapp.service.js', () => ({
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
}))

// Mock the tenant service module
const tenantServiceMock = {
  getTenantConnection: mockGetTenantConnection,
  tenantSchemaExists: mock(async (companyId: string) => true),
  getSchemaName: mock((id: string) => `tenant_${id.replace(/-/g, '_')}`),
  clearTenantConnection: mock(async () => {}),
  clearAllTenantConnections: mock(async () => {}),
  createTenantSchema: mock(async () => {}),
  dropTenantSchema: mock(async () => {}),
}
mock.module('../../services/tenant.service', () => tenantServiceMock)

// ============================================================================
// Import Service After Mocking
// ============================================================================

const { handleWhatsAppEvent } = await import('../../services/message-handler.js')

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Setup tenant database with messages for a company
 */
function setupTenantDatabase(
  companyId: string,
  messages: ReturnType<typeof createMockMessage>[]
) {
  tenantMessageData.set(companyId, messages)
  tenantDeletedMessages.set(companyId, new Set())
}

/**
 * Create a message revoke event for testing
 */
function createMessageRevokeEvent(
  companyId: string,
  connectionId: string,
  whatsappMessageId: string,
  senderJid: string,
  recipientJid: string
): MessageRevokeEvent {
  const timestamp = new Date().toISOString()

  return {
    type: 'message_revoke',
    companyId,
    connectionId,
    timestamp,
    payload: {
      messageId: whatsappMessageId,
      from: senderJid,
      to: recipientJid,
      timestamp,
    },
  }
}

/**
 * Reset the module state between tests
 */
function resetTestState() {
  resetMockState()
  mockBroadcastToCompany.mockClear()
  mockGetTenantConnection.mockClear()
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Message Revoke - End-to-End Integration Tests', () => {
  beforeEach(() => {
    resetTestState()
  })

  afterEach(() => {
    // Cleanup any resources
  })

  // ========================================================================
  // Complete Flow Tests
  // ========================================================================

  describe('Complete Message Revoke Flow', () => {
    it('should process full flow: NATS event → DB update → WebSocket broadcast', async () => {
      // Setup: Create a message in the tenant database
      const companyId = 'company-123'
      const connectionId = 'connection-abc'
      const whatsappMessageId = '3EB0123456789@s.whatsapp.net'
      const senderJid = '1234567890@s.whatsapp.net'
      const recipientJid = '9876543210@s.whatsapp.net'
      const messageId = 'msg-uuid-123'
      const contactId = 'contact-456'

      const originalMessage = createMockMessage({
        id: messageId,
        message_id: whatsappMessageId,
        contact_id: contactId,
        from_me: false,
        sender_jid: senderJid,
        content: 'This message will be deleted',
        deleted_by_sender: false,
        deleted_at: null,
      })

      setupTenantDatabase(companyId, [originalMessage])

      // Clear any previous broadcasts
      broadcastCalls.delete(companyId)

      // Act: Simulate receiving a message revoke event from WhatsApp
      const revokeEvent = createMessageRevokeEvent(
        companyId,
        connectionId,
        whatsappMessageId,
        senderJid,
        recipientJid
      )

      await handleWhatsAppEvent(revokeEvent)

      // Assert: Verify the complete flow

      // 1. Database was updated - message is marked as deleted
      const deletedIds = tenantDeletedMessages.get(companyId)
      expect(deletedIds?.has(whatsappMessageId)).toBe(true)

      // 2. WebSocket broadcast was sent
      expect(mockBroadcastToCompany).toHaveBeenCalledWith(
        companyId,
        expect.objectContaining({
          type: 'message:deleted',
          connectionId,
        })
      )

      // 3. Verify broadcast payload structure
      const broadcastPayloads = broadcastCalls.get(companyId) || []
      expect(broadcastPayloads).toHaveLength(1)

      const deletedPayload = broadcastPayloads[0]?.payload as MessageDeletedPayload
      expect(deletedPayload).toEqual({
        messageId,
        conversationId: contactId,
        whatsappMessageId,
      })

      // 4. Verify timestamp is included
      const broadcastCall = mockBroadcastToCompany.mock.calls[0]
      expect(broadcastCall[1]).toHaveProperty('timestamp')
    })

    it('should handle multiple revokes in sequence for the same conversation', async () => {
      const companyId = 'company-multi-revoke'
      const connectionId = 'connection-multi'
      const contactId = 'contact-multi'

      const messages = [
        createMockMessage({
          id: 'msg-1',
          message_id: '3EB0MSG1@s.whatsapp.net',
          contact_id: contactId,
          content: 'Message 1',
        }),
        createMockMessage({
          id: 'msg-2',
          message_id: '3EB0MSG2@s.whatsapp.net',
          contact_id: contactId,
          content: 'Message 2',
        }),
        createMockMessage({
          id: 'msg-3',
          message_id: '3EB0MSG3@s.whatsapp.net',
          contact_id: contactId,
          content: 'Message 3',
        }),
      ]

      setupTenantDatabase(companyId, messages)
      broadcastCalls.delete(companyId)

      // Revoke first message
      const event1 = createMessageRevokeEvent(
        companyId,
        connectionId,
        '3EB0MSG1@s.whatsapp.net',
        '1234567890@s.whatsapp.net',
        '9876543210@s.whatsapp.net'
      )

      await handleWhatsAppEvent(event1)

      // Revoke second message
      const event2 = createMessageRevokeEvent(
        companyId,
        connectionId,
        '3EB0MSG2@s.whatsapp.net',
        '1234567890@s.whatsapp.net',
        '9876543210@s.whatsapp.net'
      )

      await handleWhatsAppEvent(event2)

      // Verify both messages were revoked
      const deletedIds = tenantDeletedMessages.get(companyId)
      expect(deletedIds?.has('3EB0MSG1@s.whatsapp.net')).toBe(true)
      expect(deletedIds?.has('3EB0MSG2@s.whatsapp.net')).toBe(true)
      expect(deletedIds?.has('3EB0MSG3@s.whatsapp.net')).toBe(false)

      // Verify two separate broadcasts were sent
      const broadcasts = broadcastCalls.get(companyId) || []
      expect(broadcasts).toHaveLength(2)
    })

    it('should handle revokes across multiple tenant schemas', async () => {
      const companies = [
        { id: 'company-1', connectionId: 'conn-1', messageId: '3EB0COMP1@s.whatsapp.net' },
        { id: 'company-2', connectionId: 'conn-2', messageId: '3EB0COMP2@s.whatsapp.net' },
        { id: 'company-3', connectionId: 'conn-3', messageId: '3EB0COMP3@s.whatsapp.net' },
      ]

      // Setup messages for each company
      for (const company of companies) {
        const message = createMockMessage({
          id: `msg-${company.id}`,
          message_id: company.messageId,
          contact_id: `contact-${company.id}`,
          content: `Message for ${company.id}`,
        })
        setupTenantDatabase(company.id, [message])
      }

      // Process revokes for all companies
      for (const company of companies) {
        const event = createMessageRevokeEvent(
          company.id,
          company.connectionId,
          company.messageId,
          '1234567890@s.whatsapp.net',
          '9876543210@s.whatsapp.net'
        )

        await handleWhatsAppEvent(event)
      }

      // Verify all companies processed correctly
      for (const company of companies) {
        const deletedIds = tenantDeletedMessages.get(company.id)
        expect(deletedIds?.has(company.messageId)).toBe(true)

        const broadcasts = broadcastCalls.get(company.id) || []
        expect(broadcasts).toHaveLength(1)
        expect(broadcasts[0]?.type).toBe('message:deleted')
      }
    })
  })

  // ========================================================================
  // Race Condition Tests
  // ========================================================================

  describe('Race Condition Handling', () => {
    it('should handle revoke arriving before message is stored in database', async () => {
      const companyId = 'company-race-condition'
      const connectionId = 'connection-race'
      const whatsappMessageId = '3EB0RACE@s.whatsapp.net'

      // Setup: Empty tenant database (message hasn't been stored yet)
      setupTenantDatabase(companyId, [])

      // Act: Revoke event arrives before the message
      const event = createMessageRevokeEvent(
        companyId,
        connectionId,
        whatsappMessageId,
        '1234567890@s.whatsapp.net',
        '9876543210@s.whatsapp.net'
      )

      // Should not throw - handle gracefully
      const result = await handleWhatsAppEvent(event)

      // Assert: No error, no broadcast (message not found)
      expect(result).toBeUndefined()

      const broadcasts = broadcastCalls.get(companyId) || []
      expect(broadcasts).toHaveLength(0)

      // Verify no database update was recorded
      const deletedIds = tenantDeletedMessages.get(companyId)
      expect(deletedIds?.has(whatsappMessageId)).toBe(false)
    })

    it('should handle duplicate revoke events idempotently', async () => {
      const companyId = 'company-duplicate-revoke'
      const connectionId = 'connection-dup'
      const whatsappMessageId = '3EB0DUP@s.whatsapp.net'
      const messageId = 'msg-dup'
      const contactId = 'contact-dup'

      const message = createMockMessage({
        id: messageId,
        message_id: whatsappMessageId,
        contact_id: contactId,
        content: 'Message to be deleted twice',
      })

      setupTenantDatabase(companyId, [message])
      broadcastCalls.delete(companyId)

      const event = createMessageRevokeEvent(
        companyId,
        connectionId,
        whatsappMessageId,
        '1234567890@s.whatsapp.net',
        '9876543210@s.whatsapp.net'
      )

      // First revoke
      await handleWhatsAppEvent(event)

      // Second revoke (duplicate)
      await handleWhatsAppEvent(event)

      // Should handle both without error
      expect(mockBroadcastToCompany).toHaveBeenCalled()

      // The message should still be marked as deleted
      const deletedIds = tenantDeletedMessages.get(companyId)
      expect(deletedIds?.has(whatsappMessageId)).toBe(true)
    })

    it('should handle revoke with message that no longer exists', async () => {
      const companyId = 'company-message-gone'
      const connectionId = 'connection-gone'
      const whatsappMessageId = '3EB0GONE@s.whatsapp.net'

      // Setup: Database exists but message was already deleted/never existed
      setupTenantDatabase(companyId, [])

      const event = createMessageRevokeEvent(
        companyId,
        connectionId,
        whatsappMessageId,
        '1234567890@s.whatsapp.net',
        '9876543210@s.whatsapp.net'
      )

      // Should not throw
      const result = await handleWhatsAppEvent(event)
      expect(result).toBeUndefined()

      // No broadcast should occur
      const broadcasts = broadcastCalls.get(companyId) || []
      expect(broadcasts).toHaveLength(0)
    })
  })

  // ========================================================================
  // Error Recovery Tests
  // ========================================================================

  describe('Error Recovery', () => {
    it('should continue processing after tenant connection error', async () => {
      const companyId = 'non-existent-company'
      const connectionId = 'connection-error'
      const whatsappMessageId = '3EB0ERROR@s.whatsapp.net'

      // Mock getTenantConnection to throw for this specific company
      mockGetTenantConnection.mockImplementationOnce(() => {
        throw new Error('Tenant schema does not exist')
      })

      const event = createMessageRevokeEvent(
        companyId,
        connectionId,
        whatsappMessageId,
        '1234567890@s.whatsapp.net',
        '9876543210@s.whatsapp.net'
      )

      // Should not throw - handle error gracefully
      const result = await handleWhatsAppEvent(event)
      expect(result).toBeUndefined()

      // Reset mock for other tests
      mockGetTenantConnection.mockImplementation((id) => createMockTenantDb(id))
    })

    it('should handle malformed event data gracefully', async () => {
      const companyId = 'company-malformed'
      const connectionId = ''
      const whatsappMessageId = ''

      // Setup tenant with some messages
      setupTenantDatabase(companyId, [
        createMockMessage({
          id: 'msg-1',
          message_id: '3EB0VALID@s.whatsapp.net',
          content: 'Valid message',
        }),
      ])

      // Create event with empty/invalid data
      const malformedEvent: MessageRevokeEvent = {
        type: 'message_revoke',
        companyId,
        connectionId,
        timestamp: '',
        payload: {
          messageId: whatsappMessageId,
          from: '',
          to: '',
          timestamp: '',
        },
      }

      // Should attempt to process but handle gracefully
      const result = await handleWhatsAppEvent(malformedEvent)
      expect(result).toBeUndefined()

      // No message should be deleted (empty message_id won't match)
      const deletedIds = tenantDeletedMessages.get(companyId)
      expect(deletedIds?.has('')).toBe(false)
    })
  })

  // ========================================================================
  // Payload Structure Tests
  // ========================================================================

  describe('WebSocket Payload Structure', () => {
    it('should broadcast correct payload for deleted message', async () => {
      const companyId = 'company-payload-test'
      const connectionId = 'connection-payload'
      const whatsappMessageId = '3EB0PAYLOAD@s.whatsapp.net'
      const messageId = 'msg-payload-uuid'
      const contactId = 'contact-payload'

      const message = createMockMessage({
        id: messageId,
        message_id: whatsappMessageId,
        contact_id: contactId,
        content: 'Test message for payload verification',
      })

      setupTenantDatabase(companyId, [message])
      broadcastCalls.delete(companyId)

      const event = createMessageRevokeEvent(
        companyId,
        connectionId,
        whatsappMessageId,
        '1234567890@s.whatsapp.net',
        '9876543210@s.whatsapp.net'
      )

      await handleWhatsAppEvent(event)

      // Verify broadcast was called
      expect(mockBroadcastToCompany).toHaveBeenCalledTimes(1)

      // Verify the broadcast payload
      const broadcastCall = mockBroadcastToCompany.mock.calls[0]
      expect(broadcastCall[0]).toBe(companyId)

      const wsMessage = broadcastCall[1]
      expect(wsMessage.type).toBe('message:deleted')
      expect(wsMessage.connectionId).toBe(connectionId)

      // Verify the payload has the correct structure
      const payload = wsMessage.payload as MessageDeletedPayload
      expect(payload.messageId).toBe(messageId)
      expect(payload.conversationId).toBe(contactId)
      expect(payload.whatsappMessageId).toBe(whatsappMessageId)

      // Verify timestamp exists
      expect(wsMessage.timestamp).toBeDefined()
    })

    it('should include all required fields in broadcast payload', async () => {
      const companyId = 'company-fields-test'
      const connectionId = 'connection-fields'
      const whatsappMessageId = '3EB0FIELDS@s.whatsapp.net'
      const messageId = 'msg-fields-uuid'
      const contactId = 'contact-fields'

      const message = createMockMessage({
        id: messageId,
        message_id: whatsappMessageId,
        contact_id: contactId,
        content: 'Message with all fields',
      })

      setupTenantDatabase(companyId, [message])
      broadcastCalls.delete(companyId)

      const event = createMessageRevokeEvent(
        companyId,
        connectionId,
        whatsappMessageId,
        '1234567890@s.whatsapp.net',
        '9876543210@s.whatsapp.net'
      )

      await handleWhatsAppEvent(event)

      // Get the broadcast payload
      const broadcasts = broadcastCalls.get(companyId) || []
      expect(broadcasts).toHaveLength(1)

      const broadcast = broadcasts[0]
      expect(broadcast.type).toBe('message:deleted')

      const payload = broadcast.payload as MessageDeletedPayload
      expect(payload).toMatchObject({
        messageId: expect.any(String),
        conversationId: expect.any(String),
        whatsappMessageId: expect.any(String),
      })
    })
  })

  // ========================================================================
  // Multi-Tenant Isolation Tests
  // ========================================================================

  describe('Multi-Tenant Isolation', () => {
    it('should not leak delete status between tenant schemas', async () => {
      const company1 = 'company-isolation-1'
      const company2 = 'company-isolation-2'

      // Same message ID in different tenant schemas
      const sharedMessageId = '3EB0SHARED@s.whatsapp.net'

      const message1 = createMockMessage({
        id: 'msg-in-company-1',
        message_id: sharedMessageId,
        contact_id: 'contact-1',
        content: 'Message in company 1',
      })

      const message2 = createMockMessage({
        id: 'msg-in-company-2',
        message_id: sharedMessageId,
        contact_id: 'contact-2',
        content: 'Message in company 2',
      })

      setupTenantDatabase(company1, [message1])
      setupTenantDatabase(company2, [message2])

      // Revoke message in company 1 only
      const event = createMessageRevokeEvent(
        company1,
        'connection-1',
        sharedMessageId,
        '1234567890@s.whatsapp.net',
        '9876543210@s.whatsapp.net'
      )

      await handleWhatsAppEvent(event)

      // Verify company 1 message is deleted
      const deletedIds1 = tenantDeletedMessages.get(company1)
      expect(deletedIds1?.has(sharedMessageId)).toBe(true)

      // Verify company 2 message is NOT deleted (isolation)
      const deletedIds2 = tenantDeletedMessages.get(company2)
      expect(deletedIds2?.has(sharedMessageId)).toBe(false)

      // Verify broadcast only went to company 1
      expect(mockBroadcastToCompany).toHaveBeenCalledWith(
        company1,
        expect.any(Object)
      )
      expect(mockBroadcastToCompany).not.toHaveBeenCalledWith(
        company2,
        expect.any(Object)
      )
    })
  })
})
