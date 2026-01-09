/**
 * WebSocket event handlers
 *
 * Registers all WebSocket event handlers on a client instance.
 * Extracted from WebSocketProvider for better organization and testability.
 */

import type { QueryClient } from '@tanstack/react-query'
import type {
  ConversationReadPayload,
  MediaDownloadedPayload,
  MediaDownloadFailedPayload,
  Message,
  MessageDeletedPayload,
  MessageStatus,
  MessageStatusPayload,
  NewMessagePayload,
  PresencePayload,
  ProfilePicturePayload,
  SyncStatusPayload,
  TypingPayload,
} from '@whatsapp-web/shared'
import { markConversationAsRead } from '../../lib/api/conversations'
import type { WebSocketClient } from '../../lib/websocket'
import { wsLogger } from '../../lib/websocket-logger'
import { useChatStore } from '../../stores/chat-store'
import type { TypingIndicator } from '../../stores/chat-store'
import {
  addMessageToCache,
  invalidateChatList,
  refetchConversationMessages,
  updateContactInChatList,
  updateMessageInCache,
} from './cache-utils'
import type { SyncState } from './types'

/**
 * Callback refs needed by event handlers
 */
interface HandlerCallbacks {
  addMessageRef: React.MutableRefObject<
    (conversationId: string, message: Message) => void
  >
  updateMessageStatusRef: React.MutableRefObject<
    (conversationId: string, messageId: string, status: MessageStatus) => void
  >
  addTypingIndicatorRef: React.MutableRefObject<
    (indicator: TypingIndicator) => void
  >
  removeTypingIndicatorRef: React.MutableRefObject<
    (conversationId: string, userId: string) => void
  >
  setTypingTimeoutRef: React.MutableRefObject<
    (conversationId: string, userId: string) => void
  >
  clearTypingTimeoutRef: React.MutableRefObject<
    (conversationId: string, userId: string) => void
  >
}

/**
 * Register all WebSocket event handlers on a client
 *
 * @param client - WebSocket client instance
 * @param queryClientRef - React Query client ref
 * @param setSyncingConnections - State setter for syncing connections
 * @param callbacks - Callback refs for store updates
 * @returns Array of unsubscribe functions
 */
export function registerEventHandlers(
  client: WebSocketClient,
  queryClientRef: React.MutableRefObject<QueryClient>,
  setSyncingConnections: React.Dispatch<
    React.SetStateAction<Map<string, SyncState>>
  >,
  callbacks: HandlerCallbacks,
): (() => void)[] {
  const {
    addMessageRef,
    updateMessageStatusRef,
    addTypingIndicatorRef,
    removeTypingIndicatorRef,
    setTypingTimeoutRef,
    clearTypingTimeoutRef,
  } = callbacks

  const unsubscribes: (() => void)[] = []
  const logger = wsLogger.child('EventHandlers')

  // New message handler
  unsubscribes.push(
    client.on<NewMessagePayload>('message:new', (payload) => {
      logger.debug('New message received in realtime:', {
        messageId: payload.message.id,
        conversationId: payload.conversationId,
        content: payload.message.content?.substring(0, 50),
        senderType: payload.message.senderType,
      })

      // Update Zustand store (for legacy compatibility)
      addMessageRef.current(payload.conversationId, payload.message)

      // Update TanStack Query cache for real-time message updates
      const { added, isDuplicate } = addMessageToCache(
        queryClientRef.current,
        payload.conversationId,
        payload.message,
      )

      if (isDuplicate) {
        logger.debug('Duplicate message ignored:', payload.message.id)
      } else if (added) {
        logger.debug('Message added to cache')
      }

      // Read store state FIRST before any async operations can change it
      const selectedConversationId =
        useChatStore.getState().selectedConversationId
      const shouldAutoMark =
        selectedConversationId === payload.conversationId &&
        payload.message.senderType === 'contact'

      // Invalidate chat list queries to update unread count badges
      invalidateChatList(queryClientRef.current)

      // Auto-mark as read if user was actively viewing this conversation
      if (shouldAutoMark) {
        markConversationAsRead(payload.conversationId).catch((error) => {
          logger.error('Failed to auto-mark conversation as read:', error)
        })
      }
    }),
  )

  // Message status handler
  unsubscribes.push(
    client.on<MessageStatusPayload>('message:status', (payload) => {
      logger.debug('Message status update:', {
        conversationId: payload.conversationId,
        messageId: payload.messageId,
        status: payload.status,
      })

      // Update Zustand store (for legacy compatibility)
      updateMessageStatusRef.current(
        payload.conversationId,
        payload.messageId,
        payload.status,
      )

      // Update TanStack Query cache for real-time status updates
      updateMessageInCache(
        queryClientRef.current,
        payload.conversationId,
        payload.messageId,
        (msg) => ({ ...msg, status: payload.status }),
      )
    }),
  )

  // Typing start handler
  unsubscribes.push(
    client.on<TypingPayload>('typing:start', (payload) => {
      const indicator: TypingIndicator = {
        conversationId: payload.conversationId,
        userId: payload.userId,
        userName: payload.userName,
        startedAt: new Date(),
      }
      addTypingIndicatorRef.current(indicator)
      setTypingTimeoutRef.current(payload.conversationId, payload.userId)
    }),
  )

  // Typing stop handler
  unsubscribes.push(
    client.on<TypingPayload>('typing:stop', (payload) => {
      removeTypingIndicatorRef.current(payload.conversationId, payload.userId)
      clearTypingTimeoutRef.current(payload.conversationId, payload.userId)
    }),
  )

  // Note: conversation:updated event is intentionally not handled here.
  // Components can subscribe directly via the WebSocket client if needed.

  // Conversation read handler - invalidate chat list to update unread counts
  unsubscribes.push(
    client.on<ConversationReadPayload>('conversation:read', (payload) => {
      logger.debug('Conversation marked as read:', {
        contactId: payload.contactId,
        readBy: payload.readBy,
      })

      // Invalidate chat list queries to update unread count badges
      invalidateChatList(queryClientRef.current)
    }),
  )

  // Profile picture handler
  unsubscribes.push(
    client.on<ProfilePicturePayload>('contact:profile_picture', (payload) => {
      // Update chat list cache
      updateContactInChatList(
        queryClientRef.current,
        payload.jid,
        (contact) => ({
          ...contact,
          avatarUrl: payload.profilePictureUrl,
        }),
      )

      // Update individual contact details cache
      queryClientRef.current
        .getQueriesData<Record<string, unknown>>({ queryKey: ['contact'] })
        .forEach(([queryKey, data]) => {
          if (data && data.jid === payload.jid) {
            queryClientRef.current.setQueryData(queryKey, {
              ...data,
              profilePictureUrl: payload.profilePictureUrl,
            })
          }
        })
    }),
  )

  // Message deleted handler
  unsubscribes.push(
    client.on<MessageDeletedPayload>('message:deleted', (payload) => {
      updateMessageInCache(
        queryClientRef.current,
        payload.conversationId,
        payload.messageId,
        (msg) => ({
          ...msg,
          deleted_by_sender: true,
          deleted_at: new Date().toISOString(),
        }),
      )
    }),
  )

  // Presence online handler
  unsubscribes.push(
    client.on<PresencePayload>('presence:online', (payload) => {
      logger.debug('Contact came online:', payload.jid)

      updateContactInChatList(
        queryClientRef.current,
        payload.jid,
        (contact) => ({
          ...contact,
          isOnline: true,
          lastSeen: null,
        }),
      )
    }),
  )

  // Presence offline handler
  unsubscribes.push(
    client.on<PresencePayload>('presence:offline', (payload) => {
      logger.debug(
        'Contact went offline:',
        payload.jid,
        'last seen:',
        payload.lastSeen,
      )

      updateContactInChatList(
        queryClientRef.current,
        payload.jid,
        (contact) => ({
          ...contact,
          isOnline: false,
          lastSeen: payload.lastSeen ? new Date(payload.lastSeen) : undefined,
        }),
      )
    }),
  )

  // Media downloaded handler - update message with downloaded media URL
  unsubscribes.push(
    client.on<MediaDownloadedPayload>('media:downloaded', (payload) => {
      logger.debug('Media downloaded:', {
        messageId: payload.messageId,
        conversationId: payload.conversationId,
        mediaUrl: payload.mediaUrl,
      })

      const found = updateMessageInCache(
        queryClientRef.current,
        payload.conversationId,
        payload.messageId,
        (msg) => ({
          ...msg,
          metadata: {
            ...(msg.metadata || {}),
            mediaUrl: payload.mediaUrl,
            mediaPending: false,
            mediaDownloadStatus: 'completed' as const,
            fileSize: payload.mediaSize || msg.metadata?.fileSize,
          },
        }),
      )

      if (!found) {
        logger.debug('Message not found in cache:', payload.messageId)
      }

      // Force refetch to ensure UI updates immediately
      refetchConversationMessages(queryClientRef.current, payload.conversationId)
    }),
  )

  // Media download failed handler
  unsubscribes.push(
    client.on<MediaDownloadFailedPayload>('media:download_failed', (payload) => {
      logger.warn('Media download failed:', {
        messageId: payload.messageId,
        conversationId: payload.conversationId,
        error: payload.error,
      })

      updateMessageInCache(
        queryClientRef.current,
        payload.conversationId,
        payload.messageId,
        (msg) => ({
          ...msg,
          metadata: {
            ...(msg.metadata || {}),
            mediaPending: true,
            mediaDownloadStatus: 'failed' as const,
          },
        }),
      )

      // Force refetch to ensure UI updates immediately
      refetchConversationMessages(queryClientRef.current, payload.conversationId)
    }),
  )

  // Sync event handlers
  unsubscribes.push(
    client.on<SyncStatusPayload>('sync:start', (payload) => {
      logger.info('Sync started', payload)
      const connectionId = payload.connectionId || 'unknown'
      setSyncingConnections((prev) => {
        const newMap = new Map(prev)
        // Clear interrupted flag if sync is restarting
        newMap.set(connectionId, {
          connectionId,
          conversations: 0,
          startedAt: new Date(),
          interrupted: false,
        })
        return newMap
      })
    }),
  )

  unsubscribes.push(
    client.on<SyncStatusPayload>('sync:progress', (payload) => {
      logger.debug('Sync progress', payload)
      const connectionId = payload.connectionId || 'unknown'
      setSyncingConnections((prev) => {
        const newMap = new Map(prev)
        const existing = newMap.get(connectionId)
        // Create entry if it doesn't exist (in case sync:start was missed)
        newMap.set(connectionId, {
          connectionId,
          conversations: payload.conversations,
          startedAt: existing?.startedAt || new Date(),
        })
        return newMap
      })
    }),
  )

  unsubscribes.push(
    client.on<SyncStatusPayload>('sync:complete', (payload) => {
      logger.info('Sync completed', payload)
      const connectionId = payload.connectionId || 'unknown'
      setSyncingConnections((prev) => {
        const newMap = new Map(prev)
        newMap.delete(connectionId)
        return newMap
      })
      // Invalidate chat list to show new contacts
      invalidateChatList(queryClientRef.current)
    }),
  )

  unsubscribes.push(
    client.on<SyncStatusPayload>('sync:interrupted', (payload) => {
      logger.warn('Sync interrupted by disconnection', payload)
      const connectionId = payload.connectionId || 'unknown'
      setSyncingConnections((prev) => {
        const newMap = new Map(prev)
        // Keep the sync state but mark it as interrupted
        const existing = newMap.get(connectionId)
        if (existing) {
          newMap.set(connectionId, {
            ...existing,
            interrupted: true,
          })
        }
        return newMap
      })
    }),
  )

  // Auth success handler (no-op, just acknowledges the event)
  unsubscribes.push(
    client.on('auth_success', () => {
      logger.info('Authentication successful')
    }),
  )

  logger.debug(`Handlers registered: ${unsubscribes.length}`)

  return unsubscribes
}
