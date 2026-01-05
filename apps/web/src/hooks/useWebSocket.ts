import { useCallback, useEffect, useRef } from 'react'
import { getAccessToken } from '../lib/api'
import {
  type ConversationUpdatedPayload,
  type ErrorPayload,
  type EventHandler,
  getWebSocketClient,
  type MessageStatusPayload,
  type NewMessagePayload,
  type PresencePayload,
  type TypingPayload,
  type WebSocketClient,
  type WebSocketEventType,
} from '../lib/websocket'
import { type TypingIndicator, useChatStore } from '../stores/chat-store'
import { useWebSocketStore } from '../stores/websocket-store'

// WhatsApp typing payload (different from internal TypingPayload)
interface WhatsAppTypingPayload {
  jid: string
  chatJid: string
  mediaType?: string
}

// Typing timeout in milliseconds (stop typing after 5 seconds of no updates)
const TYPING_TIMEOUT = 5000

interface UseWebSocketOptions {
  autoConnect?: boolean
  onNewMessage?: (payload: NewMessagePayload) => void
  onMessageStatus?: (payload: MessageStatusPayload) => void
  onTypingStart?: (payload: TypingPayload) => void
  onTypingStop?: (payload: TypingPayload) => void
  onPresenceChange?: (payload: PresencePayload) => void
  onConversationUpdated?: (payload: ConversationUpdatedPayload) => void
  onError?: (payload: ErrorPayload) => void
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const { autoConnect = true } = options

  const wsClientRef = useRef<WebSocketClient | null>(null)
  const typingTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Store actions
  const setStatus = useWebSocketStore((state) => state.setStatus)
  const setError = useWebSocketStore((state) => state.setError)
  const status = useWebSocketStore((state) => state.status)

  const addMessage = useChatStore((state) => state.addMessage)
  const updateMessageStatus = useChatStore((state) => state.updateMessageStatus)
  const addTypingIndicator = useChatStore((state) => state.addTypingIndicator)
  const removeTypingIndicator = useChatStore((state) => state.removeTypingIndicator)

  // Initialize WebSocket client
  const initializeClient = useCallback(() => {
    if (!wsClientRef.current) {
      const token = getAccessToken()
      wsClientRef.current = getWebSocketClient({
        url: import.meta.env.VITE_WS_URL || 'ws://localhost:3000/ws',
        token: token ?? undefined,
        onStatusChange: (newStatus) => {
          setStatus(newStatus)
        },
        onError: (error) => {
          setError(error.message)
        },
      })
    }
    return wsClientRef.current
  }, [setStatus, setError])

  // Connect to WebSocket
  const connect = useCallback(() => {
    const client = initializeClient()
    const token = getAccessToken()

    if (token) {
      client.setToken(token)
    }

    client.connect()
  }, [initializeClient])

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    wsClientRef.current?.disconnect()
  }, [])

  // Send a message through WebSocket
  const send = useCallback(function sendMessage<T>(type: string, payload: T): boolean {
    return wsClientRef.current?.send(type, payload) ?? false
  }, [])

  // Subscribe to a specific event
  const subscribe = useCallback(function subscribeToEvent<T>(
    event: WebSocketEventType,
    handler: EventHandler<T>
  ): () => void {
    return wsClientRef.current?.on(event, handler) ?? (() => {})
  }, [])

  // Helper to manage typing timeout
  const setTypingTimeout = useCallback(
    (conversationId: string, userId: string) => {
      const key = `${conversationId}:${userId}`

      // Clear existing timeout
      const existingTimeout = typingTimeoutsRef.current.get(key)
      if (existingTimeout) {
        clearTimeout(existingTimeout)
      }

      // Set new timeout
      const timeout = setTimeout(() => {
        removeTypingIndicator(conversationId, userId)
        typingTimeoutsRef.current.delete(key)
      }, TYPING_TIMEOUT)

      typingTimeoutsRef.current.set(key, timeout)
    },
    [removeTypingIndicator]
  )

  // Clear typing timeout
  const clearTypingTimeout = useCallback((conversationId: string, userId: string) => {
    const key = `${conversationId}:${userId}`
    const timeout = typingTimeoutsRef.current.get(key)
    if (timeout) {
      clearTimeout(timeout)
      typingTimeoutsRef.current.delete(key)
    }
  }, [])

  // Set up event handlers
  useEffect(() => {
    const client = initializeClient()

    // New message handler
    const unsubNewMessage = client.on<NewMessagePayload>('message:new', (payload) => {
      addMessage(payload.conversationId, payload.message)
      options.onNewMessage?.(payload)
    })

    // Message status handler
    const unsubMessageStatus = client.on<MessageStatusPayload>('message:status', (payload) => {
      updateMessageStatus(payload.conversationId, payload.messageId, payload.status)
      options.onMessageStatus?.(payload)
    })

    // Typing start handler - handles both internal typing events and WhatsApp typing events
    // WhatsApp events come with { jid, chatJid, mediaType }, internal events with { conversationId, userId, userName }
    const unsubTypingStart = client.on<TypingPayload | WhatsAppTypingPayload>(
      'typing:start',
      (payload) => {
        // Handle WhatsApp typing events (from contacts)
        if ('jid' in payload) {
          // For WhatsApp typing events, use jid as both conversationId and userId
          // The frontend will match this to the correct contact via jid
          const indicator: TypingIndicator = {
            conversationId: payload.jid, // Use jid as conversation identifier
            userId: payload.jid,
            userName: '', // Contact name will be displayed from context
            startedAt: new Date(),
          }
          addTypingIndicator(indicator)
          setTypingTimeout(payload.jid, payload.jid)
          options.onTypingStart?.({
            conversationId: payload.jid,
            userId: payload.jid,
            userName: '',
          })
        } else {
          // Handle internal typing events (from team members)
          const indicator: TypingIndicator = {
            conversationId: payload.conversationId,
            userId: payload.userId,
            userName: payload.userName,
            startedAt: new Date(),
          }
          addTypingIndicator(indicator)
          setTypingTimeout(payload.conversationId, payload.userId)
          options.onTypingStart?.(payload)
        }
      }
    )

    // Typing stop handler - handles both internal typing events and WhatsApp typing events
    const unsubTypingStop = client.on<TypingPayload | WhatsAppTypingPayload>(
      'typing:stop',
      (payload) => {
        if ('jid' in payload) {
          // Handle WhatsApp typing events
          removeTypingIndicator(payload.jid, payload.jid)
          clearTypingTimeout(payload.jid, payload.jid)
          options.onTypingStop?.({
            conversationId: payload.jid,
            userId: payload.jid,
            userName: '',
          })
        } else {
          // Handle internal typing events
          removeTypingIndicator(payload.conversationId, payload.userId)
          clearTypingTimeout(payload.conversationId, payload.userId)
          options.onTypingStop?.(payload)
        }
      }
    )

    // Presence handler
    const unsubPresenceOnline = client.on<PresencePayload>('presence:online', (payload) => {
      options.onPresenceChange?.(payload)
    })

    const unsubPresenceOffline = client.on<PresencePayload>('presence:offline', (payload) => {
      options.onPresenceChange?.(payload)
    })

    // Conversation updated handler
    const unsubConversationUpdated = client.on<ConversationUpdatedPayload>(
      'conversation:updated',
      (payload) => {
        options.onConversationUpdated?.(payload)
      }
    )

    // Error handler
    const unsubError = client.on<ErrorPayload>('error', (payload) => {
      setError(payload.message)
      options.onError?.(payload)
    })

    // Cleanup
    return () => {
      unsubNewMessage()
      unsubMessageStatus()
      unsubTypingStart()
      unsubTypingStop()
      unsubPresenceOnline()
      unsubPresenceOffline()
      unsubConversationUpdated()
      unsubError()
    }
  }, [
    initializeClient,
    addMessage,
    updateMessageStatus,
    addTypingIndicator,
    removeTypingIndicator,
    setTypingTimeout,
    clearTypingTimeout,
    setError,
    options,
  ])

  // Auto-connect on mount if enabled and we have a token
  useEffect(() => {
    if (autoConnect && getAccessToken()) {
      connect()
    }

    return () => {
      // Clear all typing timeouts on unmount
      typingTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout))
      typingTimeoutsRef.current.clear()
    }
  }, [autoConnect, connect])

  // Send typing indicator
  const sendTypingStart = useCallback(
    (conversationId: string) => {
      send('typing:start', { conversationId })
    },
    [send]
  )

  const sendTypingStop = useCallback(
    (conversationId: string) => {
      send('typing:stop', { conversationId })
    },
    [send]
  )

  // Mark messages as read
  const sendMarkAsRead = useCallback(
    (conversationId: string, messageIds: string[]) => {
      send('message:read', { conversationId, messageIds })
    },
    [send]
  )

  return {
    // Connection state
    status,
    isConnected: status === 'connected',
    isConnecting: status === 'connecting',

    // Connection methods
    connect,
    disconnect,

    // Messaging methods
    send,
    subscribe,
    sendTypingStart,
    sendTypingStop,
    sendMarkAsRead,
  }
}

// Hook for using WebSocket in components that don't need the full API
export function useWebSocketStatus() {
  return useWebSocketStore((state) => ({
    status: state.status,
    isConnected: state.status === 'connected',
    isConnecting: state.status === 'connecting',
    error: state.error,
    lastConnectedAt: state.lastConnectedAt,
    lastDisconnectedAt: state.lastDisconnectedAt,
  }))
}
