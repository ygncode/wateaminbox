import type { Message, MessageStatus } from '@whatsapp-web/shared'
import { nowMs } from '@whatsapp-web/shared'

// WebSocket event types
export type WebSocketEventType =
  | 'message:new'
  | 'message:status'
  | 'message:deleted'
  | 'typing:start'
  | 'typing:stop'
  | 'presence:online'
  | 'presence:offline'
  | 'contact:profile_picture'
  | 'conversation:updated'
  | 'conversation:read'
  | 'notification:new'
  | 'error'
  // Media download events
  | 'media:downloaded'
  | 'media:download_failed'
  // Sync events
  | 'sync:start'
  | 'sync:progress'
  | 'sync:complete'
  // WhatsApp connection events
  | 'qr'
  | 'connected'
  | 'disconnected'
  | 'auth_success'
  | 'auth_error'

// WebSocket message payloads
export interface WebSocketMessage<T = unknown> {
  type: WebSocketEventType
  payload: T
  timestamp: number
  // Optional connection identifier for multi-connection events (qr/connected/disconnected)
  connectionId?: string
}

export interface NewMessagePayload {
  message: Message
  conversationId: string
}

export interface MessageStatusPayload {
  messageId: string
  conversationId: string
  status: MessageStatus
}

export interface MessageDeletedPayload {
  messageId: string
  conversationId: string
}

export interface TypingPayload {
  conversationId: string
  userId: string
  userName: string
}

export interface PresencePayload {
  userId: string
  status: 'online' | 'offline'
  lastSeen?: Date
}

export interface ProfilePicturePayload {
  jid: string
  profilePictureUrl: string | null
}

export interface ConversationUpdatedPayload {
  conversationId: string
  lastMessage?: Message
  unreadCount?: number
}

export interface ConversationReadPayload {
  contactId: string
  unreadCount: number
  readBy: string
}

export interface NotificationPayload {
  // Empty payload - frontend will refetch notification count
}

export interface ErrorPayload {
  code: string
  message: string
}

// Sync event payloads
export interface SyncStatusPayload {
  messageCount: number
  conversations: number
}

// WhatsApp connection event payloads
export interface QRCodePayload {
  qrCode: string
  expiresAt: string
  connectionId?: string // For multi-connection support
}

export interface WhatsAppConnectedPayload {
  phoneNumber: string
  jid: string
  connectionId?: string // For multi-connection support
}

export interface WhatsAppDisconnectedPayload {
  reason?: string
  connectionId?: string // For multi-connection support
}

export interface AuthSuccessPayload {
  userId: string
  companyId: string
  message: string
}

export interface AuthErrorPayload {
  message: string
}

// Connection status
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

// Event handler type
export type EventHandler<T = unknown> = (payload: T) => void

// WebSocket client configuration
export interface WebSocketClientConfig {
  url: string
  token?: string
  reconnectAttempts?: number
  reconnectBaseDelay?: number
  reconnectMaxDelay?: number
  heartbeatInterval?: number
  pongTimeout?: number
  connectionTimeout?: number
  onStatusChange?: (status: ConnectionStatus) => void
  onError?: (error: Error) => void
}

// Message queue item for messages sent while connecting
interface QueuedMessage {
  type: string
  payload: unknown
  resolve: (success: boolean) => void
}

const DEFAULT_CONFIG: Required<
  Omit<WebSocketClientConfig, 'url' | 'token' | 'onStatusChange' | 'onError'>
> = {
  reconnectAttempts: 10,
  reconnectBaseDelay: 1000,
  reconnectMaxDelay: 30000,
  heartbeatInterval: 30000,
  pongTimeout: 10000,
  connectionTimeout: 15000,
}

export class WebSocketClient {
  private socket: WebSocket | null = null
  private config: WebSocketClientConfig & typeof DEFAULT_CONFIG
  private reconnectCount = 0
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private pongTimeout: ReturnType<typeof setTimeout> | null = null
  private connectionTimeout: ReturnType<typeof setTimeout> | null = null
  private eventHandlers: Map<WebSocketEventType, Set<EventHandler>> = new Map()
  private _status: ConnectionStatus = 'disconnected'
  private manualDisconnect = false
  private isCleaningUp = false
  private messageQueue: QueuedMessage[] = []
  private lastPongReceived: number = 0
  private boundHandlers: {
    onOpen: () => void
    onClose: (event: CloseEvent) => void
    onError: (event: Event) => void
    onMessage: (event: MessageEvent) => void
  } | null = null

  constructor(config: WebSocketClientConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  // Getters
  get status(): ConnectionStatus {
    return this._status
  }

  get isConnected(): boolean {
    return (
      this._status === 'connected' &&
      this.socket !== null &&
      this.socket.readyState === WebSocket.OPEN
    )
  }

  get isConnecting(): boolean {
    return (
      this._status === 'connecting' &&
      this.socket !== null &&
      this.socket.readyState === WebSocket.CONNECTING
    )
  }

  // Check if socket is ready for operations
  private isSocketReady(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN
  }

  // Set authentication token
  setToken(token: string): void {
    this.config.token = token
  }

  // Connect to WebSocket server
  connect(): void {
    // Prevent concurrent connection attempts
    if (this.isCleaningUp) {
      console.warn('[WebSocket] Cleanup in progress, deferring connect')
      return
    }

    // Check if already connected or connecting
    if (this.socket) {
      const state = this.socket.readyState
      if (state === WebSocket.OPEN) {
        console.warn('[WebSocket] Already connected')
        return
      }
      if (state === WebSocket.CONNECTING) {
        console.warn('[WebSocket] Connection already in progress')
        return
      }
      // Socket exists but is closing or closed - clean it up first
      if (state === WebSocket.CLOSING || state === WebSocket.CLOSED) {
        this.cleanupSocket()
      }
    }

    this.manualDisconnect = false
    this.setStatus('connecting')

    try {
      // Construct URL with auth token as query parameter
      const url = new URL(this.config.url)
      if (this.config.token) {
        url.searchParams.set('token', this.config.token)
      }

      this.socket = new WebSocket(url.toString())
      this.setupEventListeners()
      this.startConnectionTimeout()
    } catch (error) {
      console.error('[WebSocket] Connection error:', error)
      this.setStatus('error')
      this.config.onError?.(error instanceof Error ? error : new Error(String(error)))
      this.scheduleReconnect()
    }
  }

  // Disconnect from WebSocket server
  disconnect(): void {
    this.manualDisconnect = true
    this.cleanup()
    this.setStatus('disconnected')
  }

  // Send a message through WebSocket
  send<T>(type: string, payload: T): boolean {
    // If connected and ready, send immediately
    if (this.isSocketReady()) {
      return this.sendImmediate(type, payload)
    }

    // If connecting, the message will fail - log warning
    if (this.isConnecting) {
      console.warn('[WebSocket] Cannot send message: connection not yet established')
      return false
    }

    console.warn('[WebSocket] Cannot send message: not connected')
    return false
  }

  // Send a message and queue if connecting (for critical messages)
  sendQueued<T>(type: string, payload: T): Promise<boolean> {
    // If connected and ready, send immediately
    if (this.isSocketReady()) {
      return Promise.resolve(this.sendImmediate(type, payload))
    }

    // If connecting, queue the message
    if (this.isConnecting) {
      return new Promise((resolve) => {
        this.messageQueue.push({ type, payload, resolve })
      })
    }

    // Not connected and not connecting
    return Promise.resolve(false)
  }

  // Internal immediate send
  private sendImmediate<T>(type: string, payload: T): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return false
    }

    try {
      const message = JSON.stringify({
        type,
        payload,
        timestamp: nowMs(),
      })
      this.socket.send(message)
      return true
    } catch (error) {
      console.error('[WebSocket] Send error:', error)
      return false
    }
  }

  // Process queued messages after connection established
  private processMessageQueue(): void {
    while (this.messageQueue.length > 0) {
      const item = this.messageQueue.shift()
      if (item) {
        const success = this.sendImmediate(item.type, item.payload)
        item.resolve(success)
      }
    }
  }

  // Clear message queue (on disconnect/error)
  private clearMessageQueue(): void {
    while (this.messageQueue.length > 0) {
      const item = this.messageQueue.shift()
      if (item) {
        item.resolve(false)
      }
    }
  }

  // Subscribe to events
  on<T = unknown>(event: WebSocketEventType, handler: EventHandler<T>): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set())
    }
    this.eventHandlers.get(event)?.add(handler as EventHandler)

    // Return unsubscribe function
    return () => {
      this.eventHandlers.get(event)?.delete(handler as EventHandler)
    }
  }

  // Unsubscribe from events
  off<T = unknown>(event: WebSocketEventType, handler: EventHandler<T>): void {
    this.eventHandlers.get(event)?.delete(handler as EventHandler)
  }

  // Subscribe to all events of a type once
  once<T = unknown>(event: WebSocketEventType, handler: EventHandler<T>): void {
    const wrappedHandler: EventHandler<T> = (payload) => {
      this.off(event, wrappedHandler)
      handler(payload)
    }
    this.on(event, wrappedHandler)
  }

  // Wait for connection to be ready
  waitForConnection(timeout: number = 5000): Promise<boolean> {
    if (this.isConnected) {
      return Promise.resolve(true)
    }

    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        resolve(false)
      }, timeout)

      const checkConnection = () => {
        if (this.isConnected) {
          clearTimeout(timeoutId)
          resolve(true)
        } else if (this._status === 'error' || this._status === 'disconnected') {
          clearTimeout(timeoutId)
          resolve(false)
        } else {
          setTimeout(checkConnection, 100)
        }
      }

      checkConnection()
    })
  }

  // Private methods
  private setupEventListeners(): void {
    if (!this.socket) return

    // Remove any existing listeners first
    this.removeSocketListeners()

    // Create bound handlers that we can remove later
    this.boundHandlers = {
      onOpen: this.handleOpen.bind(this),
      onClose: this.handleClose.bind(this),
      onError: this.handleError.bind(this),
      onMessage: this.handleMessageEvent.bind(this),
    }

    this.socket.addEventListener('open', this.boundHandlers.onOpen)
    this.socket.addEventListener('close', this.boundHandlers.onClose)
    this.socket.addEventListener('error', this.boundHandlers.onError)
    this.socket.addEventListener('message', this.boundHandlers.onMessage)
  }

  private removeSocketListeners(): void {
    if (!this.socket || !this.boundHandlers) return

    this.socket.removeEventListener('open', this.boundHandlers.onOpen)
    this.socket.removeEventListener('close', this.boundHandlers.onClose)
    this.socket.removeEventListener('error', this.boundHandlers.onError)
    this.socket.removeEventListener('message', this.boundHandlers.onMessage)
    this.boundHandlers = null
  }

  private handleOpen(): void {
    console.log('[WebSocket] ✅ Connected - Realtime updates enabled')
    this.clearConnectionTimeout()
    this.setStatus('connected')
    this.reconnectCount = 0
    this.lastPongReceived = nowMs()

    // Process any queued messages
    this.processMessageQueue()

    // Start heartbeat after connection is stable
    // Small delay to ensure connection is fully established
    setTimeout(() => {
      if (this.isConnected) {
        this.startHeartbeat()
      }
    }, 100)
  }

  private handleClose(event: CloseEvent): void {
    console.log('[WebSocket] Disconnected:', event.code, event.reason)

    // Stop heartbeat and clear timeouts
    this.stopHeartbeat()
    this.clearConnectionTimeout()
    this.clearMessageQueue()

    // Only reconnect if not manually disconnected and not already cleaning up
    if (!this.manualDisconnect && !this.isCleaningUp) {
      this.setStatus('disconnected')
      this.scheduleReconnect()
    }
  }

  private handleError(event: Event): void {
    console.error('[WebSocket] Error:', event)

    // Only set error status if we're not already disconnected/cleaning up
    if (!this.isCleaningUp && this._status !== 'disconnected') {
      this.setStatus('error')
      this.config.onError?.(new Error('WebSocket connection error'))
    }
  }

  private handleMessageEvent(event: MessageEvent): void {
    this.handleMessage(event.data)
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data) as WebSocketMessage

      // Debug: log all incoming messages
      console.log('[WebSocket] 📨 Received message:', message.type, message)

      // Handle pong response
      if (message.type === ('pong' as WebSocketEventType)) {
        this.lastPongReceived = nowMs()
        this.clearPongTimeout()
        return
      }

      // Emit event to handlers
      const handlers = this.eventHandlers.get(message.type)
      if (handlers) {
        console.log('[WebSocket] ✅ Found', handlers.size, 'handler(s) for:', message.type)
        handlers.forEach((handler) => {
          try {
            const payloadWithConnection =
              message.connectionId !== undefined &&
              message.payload !== null &&
              typeof message.payload === 'object'
                ? {
                    ...(message.payload as Record<string, unknown>),
                    connectionId: message.connectionId,
                  }
                : message.connectionId !== undefined
                  ? { connectionId: message.connectionId }
                  : message.payload

            handler(payloadWithConnection as unknown as never)
          } catch (error) {
            console.error(`[WebSocket] Handler error for ${message.type}:`, error)
          }
        })
      } else {
        console.log('[WebSocket] ⚠️ No handlers registered for:', message.type)
      }
    } catch (error) {
      console.error('[WebSocket] Failed to parse message:', error)
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (this._status !== status) {
      this._status = status
      this.config.onStatusChange?.(status)
    }
  }

  private startConnectionTimeout(): void {
    this.clearConnectionTimeout()
    this.connectionTimeout = setTimeout(() => {
      if (this._status === 'connecting') {
        console.warn('[WebSocket] Connection timeout')
        this.cleanupSocket()
        this.setStatus('error')
        this.config.onError?.(new Error('WebSocket connection timeout'))
        this.scheduleReconnect()
      }
    }, this.config.connectionTimeout)
  }

  private clearConnectionTimeout(): void {
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout)
      this.connectionTimeout = null
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()

    this.heartbeatInterval = setInterval(() => {
      // Double-check socket is truly ready before sending ping
      if (this.isSocketReady()) {
        const sent = this.sendImmediate('ping', {})
        if (sent) {
          this.setPongTimeout()
        }
      } else {
        // Socket not ready, stop heartbeat
        this.stopHeartbeat()
      }
    }, this.config.heartbeatInterval)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
    this.clearPongTimeout()
  }

  private setPongTimeout(): void {
    this.clearPongTimeout()
    this.pongTimeout = setTimeout(() => {
      console.warn('[WebSocket] Pong timeout - connection may be stale')

      // Check if we've received any pong recently
      const timeSinceLastPong = nowMs() - this.lastPongReceived
      if (timeSinceLastPong > this.config.pongTimeout * 2) {
        console.warn('[WebSocket] No recent pong - initiating reconnect')
        // Clean up properly before reconnecting
        this.cleanupSocket()
        this.setStatus('disconnected')
        this.scheduleReconnect()
      }
    }, this.config.pongTimeout)
  }

  private clearPongTimeout(): void {
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout)
      this.pongTimeout = null
    }
  }

  private scheduleReconnect(): void {
    if (this.manualDisconnect) return
    if (this.reconnectTimeout) return // Already scheduled

    if (this.reconnectCount >= this.config.reconnectAttempts) {
      console.error('[WebSocket] Max reconnection attempts reached')
      this.setStatus('error')
      this.config.onError?.(new Error('Max reconnection attempts reached'))
      return
    }

    // Exponential backoff with jitter
    const delay = Math.min(
      this.config.reconnectBaseDelay * 2 ** this.reconnectCount + Math.random() * 1000,
      this.config.reconnectMaxDelay
    )

    console.log(
      `[WebSocket] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectCount + 1}/${this.config.reconnectAttempts})`
    )

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null
      this.reconnectCount++
      this.connect()
    }, delay)
  }

  private cleanupSocket(): void {
    if (!this.socket) return

    // Remove event listeners first to prevent any callbacks during cleanup
    this.removeSocketListeners()

    // Close the socket if it's not already closed
    try {
      if (
        this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING
      ) {
        this.socket.close(1000, 'Client cleanup')
      }
    } catch (error) {
      // Ignore errors during close
      console.debug('[WebSocket] Error during socket close:', error)
    }

    this.socket = null
  }

  private cleanup(): void {
    // Prevent re-entrant cleanup
    if (this.isCleaningUp) return
    this.isCleaningUp = true

    try {
      // Clear reconnect timeout
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout)
        this.reconnectTimeout = null
      }

      // Clear connection timeout
      this.clearConnectionTimeout()

      // Stop heartbeat
      this.stopHeartbeat()

      // Clear message queue
      this.clearMessageQueue()

      // Close socket
      this.cleanupSocket()

      // Reset reconnect counter
      this.reconnectCount = 0
    } finally {
      this.isCleaningUp = false
    }
  }

  // Destroy the client completely
  destroy(): void {
    this.disconnect()
    this.eventHandlers.clear()
  }

  // Force reconnect (useful for token refresh)
  reconnect(): void {
    this.cleanup()
    this.manualDisconnect = false
    this.connect()
  }

  // Reset reconnect counter (useful after successful operations)
  resetReconnectCounter(): void {
    this.reconnectCount = 0
  }
}

// Create a singleton instance with default configuration
let wsClientInstance: WebSocketClient | null = null

export function getWebSocketClient(config?: Partial<WebSocketClientConfig>): WebSocketClient {
  if (!wsClientInstance) {
    wsClientInstance = new WebSocketClient({
      url: config?.url ?? 'ws://localhost:3000/ws',
      ...config,
    })
  }
  return wsClientInstance
}

export function resetWebSocketClient(): void {
  wsClientInstance?.destroy()
  wsClientInstance = null
}
