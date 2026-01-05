import type { Message, MessageStatus } from '@whatsapp-web/shared'
import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import type { Contact, Conversation } from '../lib/api'

// Typing indicator type
export interface TypingIndicator {
  conversationId: string
  userId: string
  userName: string
  startedAt: Date
}

// Optimistic message for pending sends
export interface OptimisticMessage extends Message {
  isOptimistic: true
  tempId: string
}

export interface ChatState {
  // Currently selected chat
  selectedConversationId: string | null
  selectedConversation: Conversation | null
  selectedContact: Contact | null

  // Typing indicators (keyed by conversationId)
  typingIndicators: Map<string, TypingIndicator[]>

  // Messages cache (keyed by conversationId)
  messagesCache: Map<string, Message[]>

  // Optimistic messages waiting to be confirmed
  optimisticMessages: Map<string, OptimisticMessage>

  // Last read message per conversation
  lastReadMessageId: Map<string, string>

  // Draft messages per conversation
  draftMessages: Map<string, string>

  // Selection mode state (NOT persisted)
  selectionMode: boolean
  selectedMessageIds: Set<string>

  // Actions
  selectConversation: (
    conversationId: string | null,
    conversation?: Conversation,
    contact?: Contact
  ) => void

  // Typing indicators
  addTypingIndicator: (indicator: TypingIndicator) => void
  removeTypingIndicator: (conversationId: string, userId: string) => void
  clearTypingIndicators: (conversationId: string) => void

  // Messages
  setMessages: (conversationId: string, messages: Message[]) => void
  addMessage: (conversationId: string, message: Message) => void
  updateMessage: (conversationId: string, messageId: string, updates: Partial<Message>) => void
  updateMessageStatus: (conversationId: string, messageId: string, status: MessageStatus) => void
  removeMessage: (conversationId: string, messageId: string) => void
  prependMessages: (conversationId: string, messages: Message[]) => void

  // Optimistic updates
  addOptimisticMessage: (message: OptimisticMessage) => void
  confirmOptimisticMessage: (tempId: string, confirmedMessage: Message) => void
  failOptimisticMessage: (tempId: string) => void

  // Read status
  setLastReadMessageId: (conversationId: string, messageId: string) => void

  // Drafts
  setDraftMessage: (conversationId: string, content: string) => void
  clearDraftMessage: (conversationId: string) => void

  // Selection mode
  enterSelectionMode: () => void
  exitSelectionMode: () => void
  toggleMessageSelection: (messageId: string) => void
  selectAllMessages: (messageIds: string[]) => void
  clearSelection: () => void

  // Reset
  reset: () => void
}

const initialState = {
  selectedConversationId: null,
  selectedConversation: null,
  selectedContact: null,
  typingIndicators: new Map<string, TypingIndicator[]>(),
  messagesCache: new Map<string, Message[]>(),
  optimisticMessages: new Map<string, OptimisticMessage>(),
  lastReadMessageId: new Map<string, string>(),
  draftMessages: new Map<string, string>(),
  selectionMode: false,
  selectedMessageIds: new Set<string>(),
}

export const useChatStore = create<ChatState>()(
  devtools(
    persist(
      (set, _get) => ({
        ...initialState,

        // Select conversation
        selectConversation: (conversationId, conversation, contact) =>
          set(
            {
              selectedConversationId: conversationId,
              selectedConversation: conversation ?? null,
              selectedContact: contact ?? null,
            },
            false,
            'selectConversation'
          ),

        // Typing indicators
        addTypingIndicator: (indicator) =>
          set(
            (state) => {
              const newMap = new Map(state.typingIndicators)
              const existing = newMap.get(indicator.conversationId) ?? []

              // Don't add duplicate
              if (existing.some((t) => t.userId === indicator.userId)) {
                return state
              }

              newMap.set(indicator.conversationId, [...existing, indicator])
              return { typingIndicators: newMap }
            },
            false,
            'addTypingIndicator'
          ),

        removeTypingIndicator: (conversationId, userId) =>
          set(
            (state) => {
              const newMap = new Map(state.typingIndicators)
              const existing = newMap.get(conversationId) ?? []
              const filtered = existing.filter((t) => t.userId !== userId)

              if (filtered.length === 0) {
                newMap.delete(conversationId)
              } else {
                newMap.set(conversationId, filtered)
              }

              return { typingIndicators: newMap }
            },
            false,
            'removeTypingIndicator'
          ),

        clearTypingIndicators: (conversationId) =>
          set(
            (state) => {
              const newMap = new Map(state.typingIndicators)
              newMap.delete(conversationId)
              return { typingIndicators: newMap }
            },
            false,
            'clearTypingIndicators'
          ),

        // Messages
        setMessages: (conversationId, messages) =>
          set(
            (state) => {
              const newMap = new Map(state.messagesCache)
              newMap.set(conversationId, messages)
              return { messagesCache: newMap }
            },
            false,
            'setMessages'
          ),

        addMessage: (conversationId, message) =>
          set(
            (state) => {
              const newMap = new Map(state.messagesCache)
              const existing = newMap.get(conversationId) ?? []

              // Don't add duplicate messages
              if (existing.some((m) => m.id === message.id)) {
                return state
              }

              newMap.set(conversationId, [...existing, message])
              return { messagesCache: newMap }
            },
            false,
            'addMessage'
          ),

        updateMessage: (conversationId, messageId, updates) =>
          set(
            (state) => {
              const newMap = new Map(state.messagesCache)
              const existing = newMap.get(conversationId)

              if (!existing) return state

              const updatedMessages = existing.map((msg) =>
                msg.id === messageId ? { ...msg, ...updates } : msg
              )

              newMap.set(conversationId, updatedMessages)
              return { messagesCache: newMap }
            },
            false,
            'updateMessage'
          ),

        updateMessageStatus: (conversationId, messageId, status) =>
          set(
            (state) => {
              const newMap = new Map(state.messagesCache)
              const existing = newMap.get(conversationId)

              if (!existing) return state

              const updatedMessages = existing.map((msg) =>
                msg.id === messageId ? { ...msg, status } : msg
              )

              newMap.set(conversationId, updatedMessages)
              return { messagesCache: newMap }
            },
            false,
            'updateMessageStatus'
          ),

        removeMessage: (conversationId, messageId) =>
          set(
            (state) => {
              const newMap = new Map(state.messagesCache)
              const existing = newMap.get(conversationId)

              if (!existing) return state

              const filtered = existing.filter((msg) => msg.id !== messageId)
              newMap.set(conversationId, filtered)
              return { messagesCache: newMap }
            },
            false,
            'removeMessage'
          ),

        prependMessages: (conversationId, messages) =>
          set(
            (state) => {
              const newMap = new Map(state.messagesCache)
              const existing = newMap.get(conversationId) ?? []

              // Filter out duplicates
              const existingIds = new Set(existing.map((m) => m.id))
              const newMessages = messages.filter((m) => !existingIds.has(m.id))

              newMap.set(conversationId, [...newMessages, ...existing])
              return { messagesCache: newMap }
            },
            false,
            'prependMessages'
          ),

        // Optimistic updates
        addOptimisticMessage: (message) =>
          set(
            (state) => {
              const newOptimistic = new Map(state.optimisticMessages)
              newOptimistic.set(message.tempId, message)

              const newMessages = new Map(state.messagesCache)
              const existing = newMessages.get(message.conversationId) ?? []
              newMessages.set(message.conversationId, [...existing, message as Message])

              return {
                optimisticMessages: newOptimistic,
                messagesCache: newMessages,
              }
            },
            false,
            'addOptimisticMessage'
          ),

        confirmOptimisticMessage: (tempId, confirmedMessage) =>
          set(
            (state) => {
              const optimistic = state.optimisticMessages.get(tempId)
              if (!optimistic) return state

              const newOptimistic = new Map(state.optimisticMessages)
              newOptimistic.delete(tempId)

              const newMessages = new Map(state.messagesCache)
              const existing = newMessages.get(confirmedMessage.conversationId) ?? []

              // Replace optimistic message with confirmed one
              const updatedMessages = existing.map((msg) =>
                (msg as OptimisticMessage).tempId === tempId ? confirmedMessage : msg
              )

              newMessages.set(confirmedMessage.conversationId, updatedMessages)

              return {
                optimisticMessages: newOptimistic,
                messagesCache: newMessages,
              }
            },
            false,
            'confirmOptimisticMessage'
          ),

        failOptimisticMessage: (tempId) =>
          set(
            (state) => {
              const optimistic = state.optimisticMessages.get(tempId)
              if (!optimistic) return state

              const newOptimistic = new Map(state.optimisticMessages)
              newOptimistic.delete(tempId)

              const newMessages = new Map(state.messagesCache)
              const existing = newMessages.get(optimistic.conversationId) ?? []

              // Mark the message as failed instead of removing
              const updatedMessages = existing.map((msg) =>
                (msg as OptimisticMessage).tempId === tempId
                  ? { ...msg, status: 'failed' as MessageStatus }
                  : msg
              )

              newMessages.set(optimistic.conversationId, updatedMessages)

              return {
                optimisticMessages: newOptimistic,
                messagesCache: newMessages,
              }
            },
            false,
            'failOptimisticMessage'
          ),

        // Read status
        setLastReadMessageId: (conversationId, messageId) =>
          set(
            (state) => {
              const newMap = new Map(state.lastReadMessageId)
              newMap.set(conversationId, messageId)
              return { lastReadMessageId: newMap }
            },
            false,
            'setLastReadMessageId'
          ),

        // Drafts
        setDraftMessage: (conversationId, content) =>
          set(
            (state) => {
              const newMap = new Map(state.draftMessages)
              if (content.trim()) {
                newMap.set(conversationId, content)
              } else {
                newMap.delete(conversationId)
              }
              return { draftMessages: newMap }
            },
            false,
            'setDraftMessage'
          ),

        clearDraftMessage: (conversationId) =>
          set(
            (state) => {
              const newMap = new Map(state.draftMessages)
              newMap.delete(conversationId)
              return { draftMessages: newMap }
            },
            false,
            'clearDraftMessage'
          ),

        // Selection mode
        enterSelectionMode: () =>
          set(
            { selectionMode: true, selectedMessageIds: new Set<string>() },
            false,
            'enterSelectionMode'
          ),

        exitSelectionMode: () =>
          set(
            { selectionMode: false, selectedMessageIds: new Set<string>() },
            false,
            'exitSelectionMode'
          ),

        toggleMessageSelection: (messageId) =>
          set(
            (state) => {
              const newSet = new Set(state.selectedMessageIds)
              if (newSet.has(messageId)) {
                newSet.delete(messageId)
              } else {
                newSet.add(messageId)
              }
              return { selectedMessageIds: newSet }
            },
            false,
            'toggleMessageSelection'
          ),

        selectAllMessages: (messageIds) =>
          set({ selectedMessageIds: new Set(messageIds) }, false, 'selectAllMessages'),

        clearSelection: () =>
          set({ selectedMessageIds: new Set<string>() }, false, 'clearSelection'),

        // Reset
        reset: () =>
          set(
            {
              ...initialState,
              typingIndicators: new Map(),
              messagesCache: new Map(),
              optimisticMessages: new Map(),
              lastReadMessageId: new Map(),
              draftMessages: new Map(),
              selectionMode: false,
              selectedMessageIds: new Set(),
            },
            false,
            'reset'
          ),
      }),
      {
        name: 'chat-store',
        // Only persist draft messages
        partialize: (state) => ({
          draftMessages: state.draftMessages,
          lastReadMessageId: state.lastReadMessageId,
        }),
        // Custom storage to handle Map serialization
        storage: {
          getItem: (name) => {
            const str = localStorage.getItem(name)
            if (!str) return null
            const parsed = JSON.parse(str)
            return {
              state: {
                ...parsed.state,
                draftMessages: new Map(parsed.state.draftMessages || []),
                lastReadMessageId: new Map(parsed.state.lastReadMessageId || []),
              },
            }
          },
          setItem: (name, value) => {
            const state = value.state as Partial<ChatState>
            const serializable = {
              state: {
                draftMessages: Array.from(state.draftMessages?.entries() ?? []),
                lastReadMessageId: Array.from(state.lastReadMessageId?.entries() ?? []),
              },
            }
            localStorage.setItem(name, JSON.stringify(serializable))
          },
          removeItem: (name) => localStorage.removeItem(name),
        },
      }
    ),
    { name: 'chat-store' }
  )
)

// Selectors
export const selectSelectedConversation = (state: ChatState) => state.selectedConversation
export const selectSelectedContact = (state: ChatState) => state.selectedContact

export const selectTypingIndicators = (conversationId: string) => (state: ChatState) =>
  state.typingIndicators.get(conversationId) ?? []

export const selectMessages = (conversationId: string) => (state: ChatState) =>
  state.messagesCache.get(conversationId) ?? []

export const selectDraftMessage = (conversationId: string) => (state: ChatState) =>
  state.draftMessages.get(conversationId) ?? ''

export const selectLastReadMessageId = (conversationId: string) => (state: ChatState) =>
  state.lastReadMessageId.get(conversationId)

export const selectHasOptimisticMessages = (state: ChatState) => state.optimisticMessages.size > 0

// Selection mode selectors
export const selectSelectionMode = (state: ChatState) => state.selectionMode
export const selectSelectedMessageIds = (state: ChatState) => state.selectedMessageIds
export const selectSelectedMessageCount = (state: ChatState) => state.selectedMessageIds.size
export const selectIsMessageSelected = (messageId: string) => (state: ChatState) =>
  state.selectedMessageIds.has(messageId)

// Helper to generate temp IDs
export function generateTempId(): string {
  return `temp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}
