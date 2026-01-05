import { useVirtualizer } from '@tanstack/react-virtual'
import { UserPlus } from 'lucide-react'
import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { type AssignmentFilter, useChats } from '../../hooks/useChats'
import type { ChatListProps } from '../../types/chat'
import { AddContactDialog } from '../contacts/AddContactDialog'
import { ChatListItem, ChatListItemSkeleton } from './ChatListItem'
import { ChatListSearch } from './ChatListSearch'

// Fixed height for chat list items for virtualization
const CHAT_ITEM_HEIGHT = 72

/**
 * Main chat list sidebar component
 * Displays searchable list of chats with last message preview
 */
export const ChatList = memo(function ChatList({
  selectedChatId,
  onChatSelect,
  className = '',
}: ChatListProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [assignmentFilter, setAssignmentFilter] = useState<AssignmentFilter>('all')
  const [isAddContactOpen, setIsAddContactOpen] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const { data: chats, isLoading, isError, error } = useChats(searchQuery, true, assignmentFilter)

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value)
  }, [])

  const handleSearchClear = useCallback(() => {
    setSearchQuery('')
  }, [])

  const handleChatClick = useCallback(
    (chatId: string) => {
      onChatSelect(chatId)
    },
    [onChatSelect]
  )

  // Filter archived chats for main view
  const visibleChats = useMemo(() => {
    return chats?.filter((chat) => !chat.isArchived) ?? []
  }, [chats])

  // Memoize getItemKey to prevent unnecessary re-renders
  const getItemKey = useCallback(
    (index: number) => visibleChats[index]?.id || index.toString(),
    [visibleChats]
  )

  // Virtualizer for chat list
  const virtualizer = useVirtualizer({
    count: visibleChats.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => CHAT_ITEM_HEIGHT,
    overscan: 5,
    getItemKey,
  })

  return (
    <div
      className={`flex flex-col h-full bg-white dark:bg-dark-secondary border-r border-gray-200 dark:border-dark-border ${className}`}
      role="navigation"
      aria-label="Chat list"
    >
      {/* Search */}
      <div className="px-3 py-2 bg-white dark:bg-dark-secondary border-b border-gray-200 dark:border-dark-border">
        <ChatListSearch
          value={searchQuery}
          onChange={handleSearchChange}
          onClear={handleSearchClear}
        />
      </div>

      {/* Assignment Filter */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-gray-200 dark:border-dark-border bg-gray-50 dark:bg-dark-secondary overflow-x-auto">
        <button
          type="button"
          onClick={() => setAssignmentFilter('all')}
          className={`px-3 py-1 text-xs font-medium rounded-full transition-colors whitespace-nowrap ${
            assignmentFilter === 'all'
              ? 'bg-whatsapp-teal-green text-white'
              : 'bg-white dark:bg-dark-tertiary text-gray-600 dark:text-dark-text-secondary hover:bg-gray-100 dark:hover:bg-dark-border border border-gray-200 dark:border-dark-border'
          }`}
        >
          All
        </button>
        <button
          type="button"
          onClick={() => setAssignmentFilter('unread')}
          className={`px-3 py-1 text-xs font-medium rounded-full transition-colors whitespace-nowrap ${
            assignmentFilter === 'unread'
              ? 'bg-whatsapp-teal-green text-white'
              : 'bg-white dark:bg-dark-tertiary text-gray-600 dark:text-dark-text-secondary hover:bg-gray-100 dark:hover:bg-dark-border border border-gray-200 dark:border-dark-border'
          }`}
        >
          Unread
        </button>
        <button
          type="button"
          onClick={() => setAssignmentFilter('assignedToMe')}
          className={`px-3 py-1 text-xs font-medium rounded-full transition-colors whitespace-nowrap ${
            assignmentFilter === 'assignedToMe'
              ? 'bg-whatsapp-teal-green text-white'
              : 'bg-white dark:bg-dark-tertiary text-gray-600 dark:text-dark-text-secondary hover:bg-gray-100 dark:hover:bg-dark-border border border-gray-200 dark:border-dark-border'
          }`}
        >
          Assigned to me
        </button>
        <button
          type="button"
          onClick={() => setAssignmentFilter('unassigned')}
          className={`px-3 py-1 text-xs font-medium rounded-full transition-colors whitespace-nowrap ${
            assignmentFilter === 'unassigned'
              ? 'bg-whatsapp-teal-green text-white'
              : 'bg-white dark:bg-dark-tertiary text-gray-600 dark:text-dark-text-secondary hover:bg-gray-100 dark:hover:bg-dark-border border border-gray-200 dark:border-dark-border'
          }`}
        >
          Unassigned
        </button>
        {/* Add Contact Button */}
        <button
          type="button"
          onClick={() => setIsAddContactOpen(true)}
          className="ml-auto p-1.5 text-whatsapp-teal-green hover:bg-whatsapp-teal-green/10 dark:hover:bg-whatsapp-teal-green/20 rounded-full transition-colors flex-shrink-0"
          title="Add new contact"
          data-testid="add-contact-button"
        >
          <UserPlus className="h-4 w-4" />
        </button>
      </div>

      {/* Add Contact Dialog */}
      <AddContactDialog open={isAddContactOpen} onOpenChange={setIsAddContactOpen} />

      {/* Chat List */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto"
        role="listbox"
        aria-label="Conversations"
      >
        {/* Loading State */}
        {isLoading && (
          <div className="divide-y divide-gray-100 dark:divide-dark-border">
            {Array.from({ length: 8 }).map((_, index) => (
              <ChatListItemSkeleton key={index} />
            ))}
          </div>
        )}

        {/* Error State */}
        {isError && (
          <div className="flex flex-col items-center justify-center h-full px-4 py-8 text-center">
            <svg
              className="w-12 h-12 text-red-400 mb-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <p className="text-gray-600 dark:text-dark-text-primary font-medium">
              Failed to load chats
            </p>
            <p className="text-sm text-gray-500 dark:text-dark-text-secondary mt-1">
              {error?.message || 'Please try again later'}
            </p>
          </div>
        )}

        {/* Empty State - No Search Results */}
        {!isLoading && !isError && visibleChats.length === 0 && searchQuery && (
          <div className="flex flex-col items-center justify-center h-full px-4 py-8 text-center">
            <svg
              className="w-12 h-12 text-gray-400 dark:text-dark-text-tertiary mb-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <p className="text-gray-600 dark:text-dark-text-primary font-medium">No chats found</p>
            <p className="text-sm text-gray-500 dark:text-dark-text-secondary mt-1">
              No results for "{searchQuery}"
            </p>
          </div>
        )}

        {/* Empty State - No Unread Chats */}
        {!isLoading &&
          !isError &&
          visibleChats.length === 0 &&
          !searchQuery &&
          assignmentFilter === 'unread' && (
            <div className="flex flex-col items-center justify-center h-full px-4 py-8 text-center">
              <svg
                className="w-12 h-12 text-whatsapp-green mb-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
              <p className="text-gray-600 dark:text-dark-text-primary font-medium">
                All caught up!
              </p>
              <p className="text-sm text-gray-500 dark:text-dark-text-secondary mt-1">
                You have no unread messages
              </p>
            </div>
          )}

        {/* Empty State - No Chats */}
        {!isLoading &&
          !isError &&
          visibleChats.length === 0 &&
          !searchQuery &&
          assignmentFilter !== 'unread' && (
            <div className="flex flex-col items-center justify-center h-full px-4 py-8 text-center">
              <svg
                className="w-12 h-12 text-gray-400 dark:text-dark-text-tertiary mb-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
              <p className="text-gray-600 dark:text-dark-text-primary font-medium">
                No conversations yet
              </p>
              <p className="text-sm text-gray-500 dark:text-dark-text-secondary mt-1">
                Start a new chat to begin messaging
              </p>
            </div>
          )}

        {/* Virtualized Chat List Items */}
        {!isLoading && !isError && visibleChats.length > 0 && (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const chat = visibleChats[virtualRow.index]
              return (
                <div
                  key={virtualRow.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <ChatListItem
                    chat={chat}
                    isSelected={chat.id === selectedChatId}
                    onClick={() => handleChatClick(chat.id)}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
})

export default ChatList
