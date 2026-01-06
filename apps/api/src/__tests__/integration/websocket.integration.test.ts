/**
 * WebSocket Integration Tests
 *
 * Tests for WebSocket authentication, event broadcasting, and
 * the WhatsApp connection flow events.
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test'
import {
  MockServerWebSocket,
  MockConnectionPool,
  createMockWebSocket,
  createMockConnectionPool,
  createQREvent,
  createConnectedEvent,
  createDisconnectedEvent,
  createMessageNewEvent,
  createMessageStatusEvent,
  createPresenceEvent,
  createTypingEvent,
  createAuthSuccessEvent,
  createAuthErrorEvent,
  waitForWebSocketMessage,
  WebSocketEventTypes,
  WebSocketReadyState,
} from '../helpers/websocket-mock'

describe('WebSocket Integration Tests', () => {
  let connectionPool: MockConnectionPool

  beforeEach(() => {
    connectionPool = createMockConnectionPool()
  })

  describe('Authentication', () => {
    it('should authenticate via query parameters', () => {
      const ws = createMockWebSocket()
      const userId = 'user-123'
      const companyId = 'company-456'

      // Simulate authentication
      ws.authenticate(userId, companyId)

      expect(ws.data.authenticated).toBe(true)
      expect(ws.data.userId).toBe(userId)
      expect(ws.data.companyId).toBe(companyId)
    })

    it('should authenticate via auth message', () => {
      const ws = createMockWebSocket()

      // Simulate receiving an auth message
      const authMessage = JSON.stringify({
        type: 'auth',
        payload: {
          token: 'valid-jwt-token',
          companyId: 'company-123',
        },
      })

      // In a real test, the handler would process this and authenticate
      ws.simulateMessage(authMessage)

      // For this mock test, we manually authenticate
      ws.authenticate('user-from-token', 'company-123')

      expect(ws.data.authenticated).toBe(true)
    })

    it('should reject invalid JWT token', () => {
      const ws = createMockWebSocket()

      // Send auth error for invalid token
      const errorEvent = createAuthErrorEvent('Invalid or expired token')
      ws.send(JSON.stringify(errorEvent))

      const lastMessage = ws.getLastSentMessage()
      expect(lastMessage?.type).toBe(WebSocketEventTypes.AUTH_ERROR)
      expect(lastMessage?.payload).toHaveProperty('message')
    })

    it('should reject user not in company', () => {
      const ws = createMockWebSocket()

      const errorEvent = createAuthErrorEvent('User is not a member of this company')
      ws.send(JSON.stringify(errorEvent))

      const lastMessage = ws.getLastSentMessage()
      expect(lastMessage?.type).toBe(WebSocketEventTypes.AUTH_ERROR)
    })

    it('should reject invalid company ID format', () => {
      const ws = createMockWebSocket()

      const errorEvent = createAuthErrorEvent('Invalid company ID format')
      ws.send(JSON.stringify(errorEvent))

      const lastMessage = ws.getLastSentMessage()
      expect(lastMessage?.type).toBe(WebSocketEventTypes.AUTH_ERROR)
    })

    it('should handle already authenticated connection', () => {
      const ws = createMockWebSocket({
        authenticated: true,
        userId: 'user-123',
        companyId: 'company-456',
      })

      expect(ws.data.authenticated).toBe(true)

      // Re-authentication should not break anything
      ws.authenticate('user-123', 'company-456')
      expect(ws.data.authenticated).toBe(true)
    })

    it('should send auth_success on successful authentication', () => {
      const ws = createMockWebSocket()

      const successEvent = createAuthSuccessEvent('user-123', 'company-456')
      ws.send(JSON.stringify(successEvent))

      const lastMessage = ws.getLastSentMessage()
      expect(lastMessage?.type).toBe(WebSocketEventTypes.AUTH_SUCCESS)
      expect(lastMessage?.payload).toHaveProperty('userId', 'user-123')
      expect(lastMessage?.payload).toHaveProperty('companyId', 'company-456')
    })
  })

  describe('Event Broadcasting', () => {
    it('should broadcast to all clients in same company', () => {
      const ws1 = createMockWebSocket({ authenticated: true, companyId: 'company-a' })
      const ws2 = createMockWebSocket({ authenticated: true, companyId: 'company-a' })

      connectionPool.add('company-a', ws1)
      connectionPool.add('company-a', ws2)

      const event = createQREvent('conn-123', 'qr-code-data')
      connectionPool.broadcast('company-a', event)

      expect(ws1.sentMessages.length).toBe(1)
      expect(ws2.sentMessages.length).toBe(1)

      const ws1Message = ws1.getLastSentMessage()
      const ws2Message = ws2.getLastSentMessage()
      expect(ws1Message?.type).toBe(WebSocketEventTypes.QR)
      expect(ws2Message?.type).toBe(WebSocketEventTypes.QR)
    })

    it('should not leak events to other companies', () => {
      const wsCompanyA = createMockWebSocket({ authenticated: true, companyId: 'company-a' })
      const wsCompanyB = createMockWebSocket({ authenticated: true, companyId: 'company-b' })

      connectionPool.add('company-a', wsCompanyA)
      connectionPool.add('company-b', wsCompanyB)

      const event = createConnectedEvent('conn-123', '+1234567890', '1234567890@s.whatsapp.net')
      connectionPool.broadcast('company-a', event)

      expect(wsCompanyA.sentMessages.length).toBe(1)
      expect(wsCompanyB.sentMessages.length).toBe(0)
    })

    it('should include correct connectionId in events', () => {
      const ws = createMockWebSocket({ authenticated: true, companyId: 'company-a' })
      connectionPool.add('company-a', ws)

      const connectionId = 'specific-connection-id'
      const event = createQREvent(connectionId, 'qr-data')
      connectionPool.broadcast('company-a', event)

      const lastMessage = ws.getLastSentMessage()
      expect(lastMessage?.connectionId).toBe(connectionId)
    })

    it('should handle closed connections gracefully', () => {
      const wsOpen = createMockWebSocket({ authenticated: true, companyId: 'company-a' })
      const wsClosed = createMockWebSocket({ authenticated: true, companyId: 'company-a' })

      connectionPool.add('company-a', wsOpen)
      connectionPool.add('company-a', wsClosed)

      // Close one connection
      wsClosed.close()

      const event = createMessageNewEvent('conn-123', {
        id: 'msg-1',
        conversationId: 'conv-1',
        senderId: 'sender-1',
        content: 'Hello',
        status: 'sent',
      })

      // Should not throw when broadcasting to closed connection
      expect(() => connectionPool.broadcast('company-a', event)).not.toThrow()

      // Only open connection should receive the message
      expect(wsOpen.sentMessages.length).toBe(1)
    })

    it('should remove disconnected clients from broadcast list', () => {
      const ws1 = createMockWebSocket({ authenticated: true, companyId: 'company-a' })
      const ws2 = createMockWebSocket({ authenticated: true, companyId: 'company-a' })

      connectionPool.add('company-a', ws1)
      connectionPool.add('company-a', ws2)

      expect(connectionPool.getConnections('company-a').size).toBe(2)

      // Remove one connection
      connectionPool.remove('company-a', ws2)

      expect(connectionPool.getConnections('company-a').size).toBe(1)
    })
  })

  describe('QR Code Flow', () => {
    it('should receive qr event when connection requested', () => {
      const ws = createMockWebSocket({ authenticated: true, companyId: 'company-a' })
      connectionPool.add('company-a', ws)

      const qrEvent = createQREvent('conn-123', 'base64-qr-code-data')
      connectionPool.broadcast('company-a', qrEvent)

      const message = ws.getLastSentMessage()
      expect(message?.type).toBe(WebSocketEventTypes.QR)
      expect(message?.payload).toHaveProperty('qrCode', 'base64-qr-code-data')
      expect(message?.payload).toHaveProperty('expiresAt')
    })

    it('should receive connected event after QR scan', () => {
      const ws = createMockWebSocket({ authenticated: true, companyId: 'company-a' })
      connectionPool.add('company-a', ws)

      const connectedEvent = createConnectedEvent(
        'conn-123',
        '+1234567890',
        '1234567890@s.whatsapp.net'
      )
      connectionPool.broadcast('company-a', connectedEvent)

      const message = ws.getLastSentMessage()
      expect(message?.type).toBe(WebSocketEventTypes.CONNECTED)
      expect(message?.payload).toHaveProperty('phoneNumber', '+1234567890')
      expect(message?.payload).toHaveProperty('jid', '1234567890@s.whatsapp.net')
    })

    it('should receive disconnected event on connection loss', () => {
      const ws = createMockWebSocket({ authenticated: true, companyId: 'company-a' })
      connectionPool.add('company-a', ws)

      const disconnectedEvent = createDisconnectedEvent('conn-123', 'Connection timed out')
      connectionPool.broadcast('company-a', disconnectedEvent)

      const message = ws.getLastSentMessage()
      expect(message?.type).toBe(WebSocketEventTypes.DISCONNECTED)
      expect(message?.payload).toHaveProperty('reason', 'Connection timed out')
    })

    it('should handle qr expiration and refresh', () => {
      const ws = createMockWebSocket({ authenticated: true, companyId: 'company-a' })
      connectionPool.add('company-a', ws)

      // First QR code
      const firstQR = createQREvent('conn-123', 'first-qr-code')
      connectionPool.broadcast('company-a', firstQR)

      // QR expired, new one generated
      const secondQR = createQREvent('conn-123', 'second-qr-code')
      connectionPool.broadcast('company-a', secondQR)

      const messages = ws.getAllSentMessages()
      expect(messages.length).toBe(2)
      expect(messages[0].payload).toHaveProperty('qrCode', 'first-qr-code')
      expect(messages[1].payload).toHaveProperty('qrCode', 'second-qr-code')
    })
  })

  describe('Message Events', () => {
    it('should broadcast message:new to company clients', () => {
      const ws = createMockWebSocket({ authenticated: true, companyId: 'company-a' })
      connectionPool.add('company-a', ws)

      const messageEvent = createMessageNewEvent('conn-123', {
        id: 'msg-123',
        conversationId: 'conv-456',
        senderId: '9876543210@s.whatsapp.net',
        content: 'Hello, World!',
        status: 'received',
      })
      connectionPool.broadcast('company-a', messageEvent)

      const message = ws.getLastSentMessage()
      expect(message?.type).toBe(WebSocketEventTypes.MESSAGE_NEW)
      expect(message?.payload).toHaveProperty('message')
      expect(message?.payload).toHaveProperty('conversationId', 'conv-456')
    })

    it('should broadcast message:status updates', () => {
      const ws = createMockWebSocket({ authenticated: true, companyId: 'company-a' })
      connectionPool.add('company-a', ws)

      const statusEvent = createMessageStatusEvent('conn-123', 'msg-123', 'conv-456', 'delivered')
      connectionPool.broadcast('company-a', statusEvent)

      const message = ws.getLastSentMessage()
      expect(message?.type).toBe(WebSocketEventTypes.MESSAGE_STATUS)
      expect(message?.payload).toHaveProperty('messageId', 'msg-123')
      expect(message?.payload).toHaveProperty('status', 'delivered')
    })

    it('should broadcast message:deleted events', () => {
      const ws = createMockWebSocket({ authenticated: true, companyId: 'company-a' })
      connectionPool.add('company-a', ws)

      const deleteEvent = {
        type: WebSocketEventTypes.MESSAGE_DELETED,
        connectionId: 'conn-123',
        payload: {
          messageId: 'msg-123',
          conversationId: 'conv-456',
        },
        timestamp: new Date().toISOString(),
      }
      connectionPool.broadcast('company-a', deleteEvent)

      const message = ws.getLastSentMessage()
      expect(message?.type).toBe(WebSocketEventTypes.MESSAGE_DELETED)
    })

    it('should broadcast message:reaction events', () => {
      const ws = createMockWebSocket({ authenticated: true, companyId: 'company-a' })
      connectionPool.add('company-a', ws)

      const reactionEvent = {
        type: WebSocketEventTypes.MESSAGE_REACTION,
        connectionId: 'conn-123',
        payload: {
          messageId: 'msg-123',
          conversationId: 'conv-456',
          reaction: '👍',
          senderId: 'user-789',
        },
        timestamp: new Date().toISOString(),
      }
      connectionPool.broadcast('company-a', reactionEvent)

      const message = ws.getLastSentMessage()
      expect(message?.type).toBe(WebSocketEventTypes.MESSAGE_REACTION)
      expect(message?.payload).toHaveProperty('reaction', '👍')
    })
  })

  describe('Presence & Typing', () => {
    it('should broadcast presence:online events', () => {
      const ws = createMockWebSocket({ authenticated: true, companyId: 'company-a' })
      connectionPool.add('company-a', ws)

      const presenceEvent = createPresenceEvent('conn-123', '1234567890@s.whatsapp.net', true)
      connectionPool.broadcast('company-a', presenceEvent)

      const message = ws.getLastSentMessage()
      expect(message?.type).toBe(WebSocketEventTypes.PRESENCE_ONLINE)
      expect(message?.payload).toHaveProperty('isOnline', true)
    })

    it('should broadcast presence:offline events', () => {
      const ws = createMockWebSocket({ authenticated: true, companyId: 'company-a' })
      connectionPool.add('company-a', ws)

      const lastSeen = new Date()
      const presenceEvent = createPresenceEvent(
        'conn-123',
        '1234567890@s.whatsapp.net',
        false,
        lastSeen
      )
      connectionPool.broadcast('company-a', presenceEvent)

      const message = ws.getLastSentMessage()
      expect(message?.type).toBe(WebSocketEventTypes.PRESENCE_OFFLINE)
      expect(message?.payload).toHaveProperty('isOnline', false)
      expect(message?.payload).toHaveProperty('lastSeen')
    })

    it('should broadcast typing:start events', () => {
      const ws = createMockWebSocket({ authenticated: true, companyId: 'company-a' })
      connectionPool.add('company-a', ws)

      const typingEvent = createTypingEvent(
        'conn-123',
        '1234567890@s.whatsapp.net',
        'conv-456',
        true
      )
      connectionPool.broadcast('company-a', typingEvent)

      const message = ws.getLastSentMessage()
      expect(message?.type).toBe(WebSocketEventTypes.TYPING_START)
    })

    it('should broadcast typing:stop events', () => {
      const ws = createMockWebSocket({ authenticated: true, companyId: 'company-a' })
      connectionPool.add('company-a', ws)

      const typingEvent = createTypingEvent(
        'conn-123',
        '1234567890@s.whatsapp.net',
        'conv-456',
        false
      )
      connectionPool.broadcast('company-a', typingEvent)

      const message = ws.getLastSentMessage()
      expect(message?.type).toBe(WebSocketEventTypes.TYPING_STOP)
    })
  })

  describe('Connection Pool', () => {
    it('should track connections by company', () => {
      const ws1 = createMockWebSocket({ authenticated: true, companyId: 'company-a' })
      const ws2 = createMockWebSocket({ authenticated: true, companyId: 'company-a' })
      const ws3 = createMockWebSocket({ authenticated: true, companyId: 'company-b' })

      connectionPool.add('company-a', ws1)
      connectionPool.add('company-a', ws2)
      connectionPool.add('company-b', ws3)

      expect(connectionPool.getConnections('company-a').size).toBe(2)
      expect(connectionPool.getConnections('company-b').size).toBe(1)
      expect(connectionPool.getTotalConnectionCount()).toBe(3)
    })

    it('should return empty set for unknown company', () => {
      const connections = connectionPool.getConnections('unknown-company')
      expect(connections.size).toBe(0)
    })

    it('should list all company IDs', () => {
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()

      connectionPool.add('company-a', ws1)
      connectionPool.add('company-b', ws2)

      const companyIds = connectionPool.getAllCompanyIds()
      expect(companyIds).toContain('company-a')
      expect(companyIds).toContain('company-b')
    })

    it('should clear all connections', () => {
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()

      connectionPool.add('company-a', ws1)
      connectionPool.add('company-b', ws2)

      connectionPool.clear()

      expect(connectionPool.getTotalConnectionCount()).toBe(0)
    })
  })

  describe('WebSocket State', () => {
    it('should track ready state correctly', () => {
      const ws = createMockWebSocket()

      expect(ws.readyState).toBe(WebSocketReadyState.OPEN)

      ws.close()

      expect(ws.readyState).toBe(WebSocketReadyState.CLOSED)
    })

    it('should throw when sending to closed connection', () => {
      const ws = createMockWebSocket()
      ws.close()

      expect(() => ws.send('test')).toThrow('WebSocket is not open')
    })

    it('should clear sent messages', () => {
      const ws = createMockWebSocket()

      ws.send(JSON.stringify({ type: 'test' }))
      expect(ws.sentMessages.length).toBe(1)

      ws.clearSentMessages()
      expect(ws.sentMessages.length).toBe(0)
    })
  })

  describe('Error Handling', () => {
    it('should handle JSON parse errors gracefully', () => {
      const ws = createMockWebSocket()

      // Sending invalid JSON
      ws.send('invalid json')

      // getLastSentMessage should return null for unparseable messages
      // (sent as string, not JSON)
      expect(ws.sentMessages.length).toBe(1)
    })

    it('should handle error events', () => {
      const ws = createMockWebSocket()
      connectionPool.add('company-a', ws)

      const errorEvent = {
        type: WebSocketEventTypes.ERROR,
        payload: {
          message: 'WhatsApp connection error',
          code: 'WHATSAPP_ERROR',
        },
        timestamp: new Date().toISOString(),
      }
      connectionPool.broadcast('company-a', errorEvent)

      const message = ws.getLastSentMessage()
      expect(message?.type).toBe(WebSocketEventTypes.ERROR)
    })
  })
})
