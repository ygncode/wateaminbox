import { useQueryClient } from '@tanstack/react-query'
import type { PaginatedMessages } from '@whatsapp-web/shared'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef } from 'react'
import { chatKeys } from '../hooks/useChats'
import { infiniteMessageKeys } from '../hooks/useInfiniteMessages'
import { getAccessToken, getCompanyId } from '../lib/api'
import {
  type ConnectionStatus,
  type ConversationReadPayload,
  type ConversationUpdatedPayload,
  type EventHandler,
  getWebSocketClient,
  type MessageDeletedPayload,
  type MessageStatusPayload,
  type NewMessagePayload,
  type ProfilePicturePayload,
  resetWebSocketClient,
  type TypingPayload,
  type WebSocketClient,
  type WebSocketEventType,
} from '../lib/websocket'
import { type TypingIndicator, useChatStore } from '../stores/chat-store'
import { useWebSocketStore } from '../stores/websocket-store'

// Context value type
interface WebSocketContextValue {
  // Connection state
  status: ConnectionStatus
  isConnected: boolean
  isConnecting: boolean
  error: string | null

  // Connection methods
  connect: () => void
  disconnect: () => void
  reconnect: () => void

  // Messaging methods
  send: <T>(type: string, payload: T) => boolean
  subscribe: <T>(event: WebSocketEventType, handler: EventHandler<T>) => () => void

  // Convenience methods
  sendTypingStart: (conversationId: string) => void
  sendTypingStop: (conversationId: string) => void
  sendMarkAsRead: (conversationId: string, messageIds: string[]) => void
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null)

// Typing timeout in milliseconds
const TYPING_TIMEOUT = 5000

interface WebSocketProviderProps {
  children: ReactNode
  autoConnect?: boolean
}

export function WebSocketProvider({ children, autoConnect = true }: WebSocketProviderProps) {
  const wsClientRef = useRef<WebSocketClient | null>(null)
  const typingTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const isInitializedRef = useRef(false)

  // TanStack Query client for cache updates
  const queryClient = useQueryClient()
  const queryClientRef = useRef(queryClient)
  queryClientRef.current = queryClient

  // WebSocket store
  const status = useWebSocketStore((state) => state.status)
  const error = useWebSocketStore((state) => state.error)
  const setStatus = useWebSocketStore((state) => state.setStatus)
  const setError = useWebSocketStore((state) => state.setError)
  const resetWsStore = useWebSocketStore((state) => state.reset)

  // Chat store
  const addMessage = useChatStore((state) => state.addMessage)
  const updateMessageStatus = useChatStore((state) => state.updateMessageStatus)
  const addTypingIndicator = useChatStore((state) => state.addTypingIndicator)
  const removeTypingIndicator = useChatStore((state) => state.removeTypingIndicator)

  // Initialize WebSocket client
  const initializeClient = useCallback(() => {
    if (!wsClientRef.current) {
      const token = getAccessToken()
      const companyId = getCompanyId()

      // Build WebSocket URL with token and company ID
      const baseUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:3000/ws'
      const wsUrl = new URL(baseUrl)
      if (token) {
        wsUrl.searchParams.set('token', token)
      }
      if (companyId) {
        wsUrl.searchParams.set('company', companyId)
      }

      wsClientRef.current = getWebSocketClient({
        url: wsUrl.toString(),
        token: token ?? undefined,
        onStatusChange: (newStatus) => {
          setStatus(newStatus)
        },
        onError: (err) => {
          setError(err.message)
        },
      })
    }
    return wsClientRef.current
  }, [setStatus, setError])

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

  // Reconnect (disconnect then connect)
  const reconnect = useCallback(() => {
    disconnect()
    // Small delay before reconnecting
    setTimeout(() => {
      connect()
    }, 100)
  }, [connect, disconnect])

  // Send a message through WebSocket
  const send = useCallback(function sendMessage<T>(type: string, payload: T): boolean {
    return wsClientRef.current?.send(type, payload) ?? false
  }, [])

  // Subscribe to a specific event
  const subscribe = useCallback(
    function subscribeToEvent<T>(event: WebSocketEventType, handler: EventHandler<T>): () => void {
      const client = initializeClient()
      return client.on(event, handler)
    },
    [initializeClient]
  )

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

  // Store callbacks in refs to avoid dependency changes triggering reconnects
  const addMessageRef = useRef(addMessage)
  const updateMessageStatusRef = useRef(updateMessageStatus)
  const addTypingIndicatorRef = useRef(addTypingIndicator)
  const removeTypingIndicatorRef = useRef(removeTypingIndicator)
  const setTypingTimeoutRef = useRef(setTypingTimeout)
  const clearTypingTimeoutRef = useRef(clearTypingTimeout)

  // Update refs when callbacks change
  useEffect(() => {
    addMessageRef.current = addMessage
    updateMessageStatusRef.current = updateMessageStatus
    addTypingIndicatorRef.current = addTypingIndicator
    removeTypingIndicatorRef.current = removeTypingIndicator
    setTypingTimeoutRef.current = setTypingTimeout
    clearTypingTimeoutRef.current = clearTypingTimeout
  })

  // Set up event handlers and auto-connect
  useEffect(() => {
    if (isInitializedRef.current) return
    isInitializedRef.current = true

    const client = initializeClient()

    // New message handler
    const unsubNewMessage = client.on<NewMessagePayload>('message:new', (payload) => {
      console.log('[WebSocket] 💬 New message received in realtime:', {
        messageId: payload.message.id,
        conversationId: payload.conversationId,
        content: payload.message.content?.substring(0, 50),
        senderType: payload.message.senderType,
      })

      // Update Zustand store (for legacy compatibility)
      addMessageRef.current(payload.conversationId, payload.message)

      // Update TanStack Query cache for real-time message updates
      const queryKey = infiniteMessageKeys.list(payload.conversationId)
      queryClientRef.current.setQueryData<{
        pages: PaginatedMessages[]
        pageParams: (string | undefined)[]
      }>(queryKey, (oldData) => {
        if (!oldData) return oldData

        // Check if message already exists to avoid duplicates
        const messageExists = oldData.pages.some((page) =>
          page.messages.some((msg) => msg.id === payload.message.id)
        )
        if (messageExists) {
          console.log('[WebSocket] ⚠️ Duplicate message ignored:', payload.message.id)
          return oldData
        }

        // Add the new message to the first page (most recent)
        const newPages = [...oldData.pages]
        if (newPages.length > 0) {
          newPages[0] = {
            ...newPages[0],
            messages: [payload.message, ...newPages[0].messages],
          }
          console.log(
            '[WebSocket] ✅ Message added to cache, total messages:',
            newPages.reduce((sum, page) => sum + page.messages.length, 0)
          )
        }

        return {
          ...oldData,
          pages: newPages,
        }
      })

      // Invalidate chat list queries to update unread count badges
      // This ensures the sidebar shows updated unread counts when new messages arrive
      queryClientRef.current.invalidateQueries({
        queryKey: chatKeys.lists(),
      })
    })

    // Message status handler
    const unsubMessageStatus = client.on<MessageStatusPayload>('message:status', (payload) => {
      console.log('[WebSocket] 📬 Message status update:', {
        conversationId: payload.conversationId,
        messageId: payload.messageId,
        status: payload.status,
      })

      // Update Zustand store (for legacy compatibility)
      updateMessageStatusRef.current(payload.conversationId, payload.messageId, payload.status)

      // Update TanStack Query cache for real-time status updates
      const queryKey = infiniteMessageKeys.list(payload.conversationId)
      queryClientRef.current.setQueryData<{
        pages: PaginatedMessages[]
        pageParams: (string | undefined)[]
      }>(queryKey, (oldData) => {
        if (!oldData) return oldData

        // Find and update the message status in all pages
        const newPages = oldData.pages.map((page) => ({
          ...page,
          messages: page.messages.map((msg) =>
            msg.id === payload.messageId ? { ...msg, status: payload.status } : msg
          ),
        }))

        return {
          ...oldData,
          pages: newPages,
        }
      })
    })

    // Typing start handler
    const unsubTypingStart = client.on<TypingPayload>('typing:start', (payload) => {
      const indicator: TypingIndicator = {
        conversationId: payload.conversationId,
        userId: payload.userId,
        userName: payload.userName,
        startedAt: new Date(),
      }
      addTypingIndicatorRef.current(indicator)
      setTypingTimeoutRef.current(payload.conversationId, payload.userId)
    })

    // Typing stop handler
    const unsubTypingStop = client.on<TypingPayload>('typing:stop', (payload) => {
      removeTypingIndicatorRef.current(payload.conversationId, payload.userId)
      clearTypingTimeoutRef.current(payload.conversationId, payload.userId)
    })

    // Conversation updated handler (can be used by consumers)
    const unsubConversationUpdated = client.on<ConversationUpdatedPayload>(
      'conversation:updated',
      () => {
        // This event can be handled by individual components via subscribe
      }
    )

    // Conversation read handler - invalidate chat list to update unread counts
    const unsubConversationRead = client.on<ConversationReadPayload>(
      'conversation:read',
      (payload) => {
        console.log('[WebSocket] 📖 Conversation marked as read:', {
          contactId: payload.contactId,
          readBy: payload.readBy,
        })

        // Invalidate chat list queries to update unread count badges
        queryClientRef.current.invalidateQueries({
          queryKey: chatKeys.lists(),
        })
      }
    )

    // Profile picture handler
    const unsubProfilePicture = client.on<ProfilePicturePayload>(
      'contact:profile_picture',
      (payload) => {
        // Update chat list cache
        queryClientRef.current.setQueriesData({ queryKey: chatKeys.lists() }, (oldData: any) => {
          if (!oldData) return oldData
          // oldData is Chat[]
          return oldData.map((chat: any) => {
            // Check if this chat corresponds to the contact JID
            if (chat.contact?.jid === payload.jid) {
              return {
                ...chat,
                contact: {
                  ...chat.contact,
                  avatarUrl: payload.profilePictureUrl,
                },
              }
            }
            return chat
          })
        })

        // Update individual contact details cache
        queryClientRef.current
          .getQueriesData({ queryKey: ['contact'] })
          .forEach(([queryKey, oldData]: [any, any]) => {
            if (oldData && oldData.jid === payload.jid) {
              queryClientRef.current.setQueryData(queryKey, {
                ...oldData,
                profilePictureUrl: payload.profilePictureUrl,
              })
            }
          })
      }
    )

    // Message deleted handler
    const unsubMessageDeleted = client.on<MessageDeletedPayload>('message:deleted', (payload) => {
      // Update TanStack Query cache to mark the message as deleted
      const queryKey = infiniteMessageKeys.list(payload.conversationId)
      queryClientRef.current.setQueryData<{
        pages: PaginatedMessages[]
        pageParams: (string | undefined)[]
      }>(queryKey, (oldData) => {
        if (!oldData) return oldData

        // Find and update the message in all pages
        const newPages = oldData.pages.map((page) => ({
          ...page,
          messages: page.messages.map((msg) =>
            msg.id === payload.messageId
              ? {
                  ...msg,
                  deleted_by_sender: true,
                  deleted_at: new Date().toISOString(),
                }
              : msg
          ),
        }))

        return {
          ...oldData,
          pages: newPages,
        }
      })
    })

    // Presence online handler
    const unsubPresenceOnline = client.on<{
      jid: string
      isOnline: boolean
      lastSeen?: string
    }>('presence:online', (payload) => {
      console.log('[WebSocket] ✅ Contact came online:', payload.jid)

      // Update chat list cache
      queryClientRef.current.setQueriesData({ queryKey: chatKeys.lists() }, (oldData: any) => {
        if (!oldData) return oldData
        return oldData.map((chat: any) => {
          if (chat.contact?.jid === payload.jid) {
            return {
              ...chat,
              contact: {
                ...chat.contact,
                isOnline: true,
                lastSeen: null,
              },
            }
          }
          return chat
        })
      })
    })

    // Presence offline handler
    const unsubPresenceOffline = client.on<{
      jid: string
      isOnline: boolean
      lastSeen?: string
    }>('presence:offline', (payload) => {
      console.log(
        '[WebSocket] 🔴 Contact went offline:',
        payload.jid,
        'last seen:',
        payload.lastSeen
      )

      // Update chat list cache
      queryClientRef.current.setQueriesData({ queryKey: chatKeys.lists() }, (oldData: any) => {
        if (!oldData) return oldData
        return oldData.map((chat: any) => {
          if (chat.contact?.jid === payload.jid) {
            return {
              ...chat,
              contact: {
                ...chat.contact,
                isOnline: false,
                lastSeen: payload.lastSeen ? new Date(payload.lastSeen) : undefined,
              },
            }
          }
          return chat
        })
      })
    })

    // Auto-connect if enabled and we have a token
    if (autoConnect && getAccessToken()) {
      connect()
    }

    // Cleanup
    return () => {
      unsubNewMessage()
      unsubMessageStatus()
      unsubMessageDeleted()
      unsubTypingStart()
      unsubTypingStop()
      unsubConversationUpdated()
      unsubConversationRead()
      unsubProfilePicture()
      unsubPresenceOnline()
      unsubPresenceOffline()

      // Clear all typing timeouts
      typingTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout))
      typingTimeoutsRef.current.clear()

      // Disconnect and reset
      wsClientRef.current?.disconnect()
      resetWebSocketClient()
      wsClientRef.current = null
      resetWsStore()
      isInitializedRef.current = false
    }
  }, [autoConnect, connect, initializeClient, resetWsStore])

  // Context value
  const contextValue: WebSocketContextValue = {
    status,
    isConnected: status === 'connected',
    isConnecting: status === 'connecting',
    error,
    connect,
    disconnect,
    reconnect,
    send,
    subscribe,
    sendTypingStart,
    sendTypingStop,
    sendMarkAsRead,
  }

  return <WebSocketContext.Provider value={contextValue}>{children}</WebSocketContext.Provider>
}

// Hook to use WebSocket context
export function useWebSocketContext(): WebSocketContextValue {
  const context = useContext(WebSocketContext)
  if (!context) {
    throw new Error('useWebSocketContext must be used within a WebSocketProvider')
  }
  return context
}

// Re-export types
export type { WebSocketContextValue }
