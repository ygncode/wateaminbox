/**
 * WebSocket mock utilities for testing
 *
 * Provides mock implementations for WebSocket connections and
 * utilities for simulating WebSocket events in tests.
 */

import { mock } from 'bun:test'

/**
 * WebSocket ready states
 */
export const WebSocketReadyState = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const

/**
 * Mock WebSocket message for testing
 */
export interface MockWebSocketMessage {
  type: string
  payload?: unknown
  connectionId?: string
  timestamp?: string
}

/**
 * Mock ServerWebSocket implementation for testing
 */
export class MockServerWebSocket {
  readyState: number = WebSocketReadyState.OPEN
  data: {
    userId?: string
    companyId?: string
    authenticated?: boolean
  } = {}

  private messageHandlers: ((data: string | Buffer) => void)[] = []
  private closeHandlers: (() => void)[] = []
  private errorHandlers: ((error: Error) => void)[] = []
  public sentMessages: string[] = []

  send(data: string | Buffer): void {
    if (this.readyState !== WebSocketReadyState.OPEN) {
      throw new Error('WebSocket is not open')
    }
    this.sentMessages.push(typeof data === 'string' ? data : data.toString())
  }

  close(code?: number, reason?: string): void {
    this.readyState = WebSocketReadyState.CLOSED
    this.closeHandlers.forEach((handler) => handler())
  }

  // For simulating incoming messages in tests
  simulateMessage(data: string | Buffer): void {
    this.messageHandlers.forEach((handler) => handler(data))
  }

  // For simulating connection close in tests
  simulateClose(): void {
    this.readyState = WebSocketReadyState.CLOSED
    this.closeHandlers.forEach((handler) => handler())
  }

  // For simulating errors in tests
  simulateError(error: Error): void {
    this.errorHandlers.forEach((handler) => handler(error))
  }

  // Get the last sent message
  getLastSentMessage(): MockWebSocketMessage | null {
    if (this.sentMessages.length === 0) return null
    try {
      return JSON.parse(this.sentMessages[this.sentMessages.length - 1])
    } catch {
      return null
    }
  }

  // Get all sent messages as parsed objects
  getAllSentMessages(): MockWebSocketMessage[] {
    return this.sentMessages
      .map((msg) => {
        try {
          return JSON.parse(msg)
        } catch {
          return null
        }
      })
      .filter((msg): msg is MockWebSocketMessage => msg !== null)
  }

  // Clear sent messages (for test cleanup)
  clearSentMessages(): void {
    this.sentMessages = []
  }

  // Authenticate the mock connection
  authenticate(userId: string, companyId: string): void {
    this.data = {
      userId,
      companyId,
      authenticated: true,
    }
  }
}

/**
 * Creates a mock WebSocket for testing
 */
export function createMockWebSocket(options?: {
  userId?: string
  companyId?: string
  authenticated?: boolean
}): MockServerWebSocket {
  const ws = new MockServerWebSocket()
  if (options?.authenticated) {
    ws.data = {
      userId: options.userId || 'test-user-id',
      companyId: options.companyId || 'test-company-id',
      authenticated: true,
    }
  }
  return ws
}

/**
 * Mock connection pool for tracking WebSocket connections by company
 */
export class MockConnectionPool {
  private connections: Map<string, Set<MockServerWebSocket>> = new Map()

  add(companyId: string, ws: MockServerWebSocket): void {
    if (!this.connections.has(companyId)) {
      this.connections.set(companyId, new Set())
    }
    this.connections.get(companyId)!.add(ws)
  }

  remove(companyId: string, ws: MockServerWebSocket): void {
    const company = this.connections.get(companyId)
    if (company) {
      company.delete(ws)
      if (company.size === 0) {
        this.connections.delete(companyId)
      }
    }
  }

  getConnections(companyId: string): Set<MockServerWebSocket> {
    return this.connections.get(companyId) || new Set()
  }

  broadcast(companyId: string, message: MockWebSocketMessage): void {
    const connections = this.getConnections(companyId)
    const data = JSON.stringify(message)
    connections.forEach((ws) => {
      if (ws.readyState === WebSocketReadyState.OPEN) {
        ws.send(data)
      }
    })
  }

  getAllCompanyIds(): string[] {
    return Array.from(this.connections.keys())
  }

  getTotalConnectionCount(): number {
    let count = 0
    this.connections.forEach((set) => {
      count += set.size
    })
    return count
  }

  clear(): void {
    this.connections.clear()
  }
}

/**
 * Creates a mock connection pool for testing
 */
export function createMockConnectionPool(): MockConnectionPool {
  return new MockConnectionPool()
}

/**
 * WebSocket event types used in the application
 */
export const WebSocketEventTypes = {
  // Authentication
  AUTH: 'auth',
  AUTH_SUCCESS: 'auth_success',
  AUTH_ERROR: 'auth_error',

  // Connection
  QR: 'qr',
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',

  // Messages
  MESSAGE_NEW: 'message:new',
  MESSAGE_STATUS: 'message:status',
  MESSAGE_DELETED: 'message:deleted',
  MESSAGE_REACTION: 'message:reaction',

  // Presence
  PRESENCE_ONLINE: 'presence:online',
  PRESENCE_OFFLINE: 'presence:offline',
  TYPING_START: 'typing:start',
  TYPING_STOP: 'typing:stop',

  // Other
  PING: 'ping',
  PONG: 'pong',
  ERROR: 'error',
  NOTIFICATION_NEW: 'notification:new',
  CONTACT_PROFILE_PICTURE: 'contact:profile_picture',
} as const

/**
 * Creates a QR code WebSocket event
 */
export function createQREvent(
  connectionId: string,
  qrCode: string,
  expiresAt?: Date
): MockWebSocketMessage {
  return {
    type: WebSocketEventTypes.QR,
    connectionId,
    payload: {
      qrCode,
      expiresAt: (expiresAt || new Date(Date.now() + 60000)).toISOString(),
    },
    timestamp: new Date().toISOString(),
  }
}

/**
 * Creates a connected WebSocket event
 */
export function createConnectedEvent(
  connectionId: string,
  phoneNumber: string,
  jid: string
): MockWebSocketMessage {
  return {
    type: WebSocketEventTypes.CONNECTED,
    connectionId,
    payload: {
      phoneNumber,
      jid,
    },
    timestamp: new Date().toISOString(),
  }
}

/**
 * Creates a disconnected WebSocket event
 */
export function createDisconnectedEvent(
  connectionId: string,
  reason?: string
): MockWebSocketMessage {
  return {
    type: WebSocketEventTypes.DISCONNECTED,
    connectionId,
    payload: {
      reason: reason || 'User disconnected',
    },
    timestamp: new Date().toISOString(),
  }
}

/**
 * Creates a new message WebSocket event
 */
export function createMessageNewEvent(
  connectionId: string,
  message: {
    id: string
    conversationId: string
    senderId: string
    content: string
    status: string
  }
): MockWebSocketMessage {
  return {
    type: WebSocketEventTypes.MESSAGE_NEW,
    connectionId,
    payload: {
      message,
      conversationId: message.conversationId,
    },
    timestamp: new Date().toISOString(),
  }
}

/**
 * Creates a message status WebSocket event
 */
export function createMessageStatusEvent(
  connectionId: string,
  messageId: string,
  conversationId: string,
  status: 'sent' | 'delivered' | 'read'
): MockWebSocketMessage {
  return {
    type: WebSocketEventTypes.MESSAGE_STATUS,
    connectionId,
    payload: {
      messageId,
      conversationId,
      status,
    },
    timestamp: new Date().toISOString(),
  }
}

/**
 * Creates a presence WebSocket event
 */
export function createPresenceEvent(
  connectionId: string,
  jid: string,
  isOnline: boolean,
  lastSeen?: Date
): MockWebSocketMessage {
  return {
    type: isOnline
      ? WebSocketEventTypes.PRESENCE_ONLINE
      : WebSocketEventTypes.PRESENCE_OFFLINE,
    connectionId,
    payload: {
      jid,
      isOnline,
      lastSeen: lastSeen?.toISOString(),
    },
    timestamp: new Date().toISOString(),
  }
}

/**
 * Creates a typing indicator WebSocket event
 */
export function createTypingEvent(
  connectionId: string,
  jid: string,
  chatJid: string,
  isTyping: boolean
): MockWebSocketMessage {
  return {
    type: isTyping
      ? WebSocketEventTypes.TYPING_START
      : WebSocketEventTypes.TYPING_STOP,
    connectionId,
    payload: {
      jid,
      chatJid,
    },
    timestamp: new Date().toISOString(),
  }
}

/**
 * Creates an auth success WebSocket event
 */
export function createAuthSuccessEvent(
  userId: string,
  companyId: string
): MockWebSocketMessage {
  return {
    type: WebSocketEventTypes.AUTH_SUCCESS,
    payload: {
      userId,
      companyId,
      message: 'Authenticated successfully',
    },
    timestamp: new Date().toISOString(),
  }
}

/**
 * Creates an auth error WebSocket event
 */
export function createAuthErrorEvent(message: string): MockWebSocketMessage {
  return {
    type: WebSocketEventTypes.AUTH_ERROR,
    payload: {
      message,
    },
    timestamp: new Date().toISOString(),
  }
}

/**
 * Waits for a specific message type from a mock WebSocket
 */
export async function waitForWebSocketMessage(
  ws: MockServerWebSocket,
  type: string,
  timeout: number = 1000
): Promise<MockWebSocketMessage | null> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const messages = ws.getAllSentMessages()
    const found = messages.find((msg) => msg.type === type)
    if (found) return found
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return null
}

/**
 * Mock broadcast function that can be used to replace the real broadcast
 */
export const mockBroadcastToCompany = mock(
  (companyId: string, message: MockWebSocketMessage) => {}
)

/**
 * Creates mock WebSocket exports for module mocking
 */
export function createWebSocketMock(overrides: Record<string, unknown> = {}) {
  return {
    broadcastToCompany: mockBroadcastToCompany,
    connections: new Map<string, Set<MockServerWebSocket>>(),
    ...overrides,
  }
}
