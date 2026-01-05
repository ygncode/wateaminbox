import { useVirtualizer } from '@tanstack/react-virtual'
import { Loader2, Search, X } from 'lucide-react'
import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui'
import { useChats } from '../../hooks/useChats'
import type { Chat } from '../../types/chat'

interface ForwardMessageDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onForward: (targetContactId: string) => void
  isForwarding?: boolean
}

// Fixed height for chat list items for virtualization
const CHAT_ITEM_HEIGHT = 64

/**
 * Dialog for selecting a contact to forward a message to
 */
export const ForwardMessageDialog = memo(function ForwardMessageDialog({
  open,
  onOpenChange,
  onForward,
  isForwarding = false,
}: ForwardMessageDialogProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const { data: chats, isLoading } = useChats(searchQuery, true, 'all')

  // Filter to contacts that have a JID (can receive messages)
  const availableContacts = useMemo(() => {
    return (chats || []).filter((chat) => !chat.isArchived)
  }, [chats])

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value)
  }, [])

  const handleSearchClear = useCallback(() => {
    setSearchQuery('')
  }, [])

  const handleSelectContact = useCallback(
    (contactId: string) => {
      onForward(contactId)
    },
    [onForward]
  )

  // Reset search when dialog closes
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        setSearchQuery('')
      }
      onOpenChange(newOpen)
    },
    [onOpenChange]
  )

  // Virtualizer for contact list
  const virtualizer = useVirtualizer({
    count: availableContacts.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => CHAT_ITEM_HEIGHT,
    overscan: 5,
  })

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[80vh] flex flex-col p-0">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle>Forward message to</DialogTitle>
        </DialogHeader>

        {/* Search Input */}
        <div className="px-4 pb-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-dark-text-tertiary" />
            <input
              type="text"
              placeholder="Search contacts..."
              value={searchQuery}
              onChange={handleSearchChange}
              className="w-full pl-9 pr-9 py-2 text-sm bg-gray-100 dark:bg-dark-tertiary border-0 rounded-lg text-gray-900 dark:text-dark-text-primary placeholder-gray-500 dark:placeholder-dark-text-tertiary focus:outline-none focus:ring-2 focus:ring-whatsapp-teal-green"
              autoFocus
            />
            {searchQuery && (
              <button
                type="button"
                onClick={handleSearchClear}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-dark-text-tertiary hover:text-gray-600 dark:hover:text-dark-text-secondary"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Contact List */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-auto min-h-0"
          style={{ maxHeight: '50vh' }}
        >
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400 dark:text-dark-text-tertiary" />
            </div>
          ) : availableContacts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
              <p className="text-sm text-gray-500 dark:text-dark-text-secondary">
                {searchQuery ? 'No contacts found matching your search' : 'No contacts available'}
              </p>
            </div>
          ) : (
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative',
              }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const chat = availableContacts[virtualRow.index]
                return (
                  <ContactListItem
                    key={chat.id}
                    chat={chat}
                    onClick={() => handleSelectContact(chat.id)}
                    isDisabled={isForwarding}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  />
                )
              })}
            </div>
          )}
        </div>

        {/* Forwarding indicator */}
        {isForwarding && (
          <div className="absolute inset-0 bg-white/80 dark:bg-dark-elevated/80 flex items-center justify-center rounded-lg">
            <div className="flex items-center gap-2 text-gray-600 dark:text-dark-text-secondary">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>Forwarding...</span>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
})

interface ContactListItemProps {
  chat: Chat
  onClick: () => void
  isDisabled?: boolean
  style?: React.CSSProperties
}

const ContactListItem = memo(function ContactListItem({
  chat,
  onClick,
  isDisabled,
  style,
}: ContactListItemProps) {
  const { contact } = chat
  const displayName = contact.customName || contact.name || contact.jid || 'Unknown'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      style={style}
      className="w-full flex items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-gray-50 dark:hover:bg-dark-tertiary disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {/* Avatar */}
      <div className="relative flex-shrink-0">
        <div className="w-10 h-10 rounded-full overflow-hidden bg-gray-200 dark:bg-dark-tertiary">
          {contact.avatarUrl ? (
            <img
              src={contact.avatarUrl}
              alt={displayName}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : contact.isGroup ? (
            <div className="w-full h-full flex items-center justify-center bg-gray-400 dark:bg-dark-text-tertiary text-white">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 12.75c1.63 0 3.07.39 4.24.9 1.08.48 1.76 1.56 1.76 2.73V18H6v-1.62c0-1.17.68-2.25 1.76-2.73 1.17-.51 2.61-.9 4.24-.9zM4 13c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm1.13 1.1c-.37-.06-.74-.1-1.13-.1-.99 0-1.93.21-2.78.58A2.01 2.01 0 000 16.43V18h4.5v-1.62c0-.83.23-1.61.63-2.28zM20 13c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm4 3.43c0-.81-.48-1.53-1.22-1.85A6.95 6.95 0 0020 14c-.39 0-.76.04-1.13.1.4.67.63 1.45.63 2.28V18H24v-1.57zM12 6c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3z" />
              </svg>
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-whatsapp-teal-green text-white text-sm font-medium">
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
        {/* Online Indicator */}
        {!contact.isGroup && contact.isOnline && (
          <span
            className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-whatsapp-green border-2 border-white dark:border-dark-elevated rounded-full"
            aria-label="Online"
          />
        )}
      </div>

      {/* Contact Info */}
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-gray-900 dark:text-dark-text-primary truncate block">
          {displayName}
        </span>
        {contact.phoneNumber && (
          <span className="text-xs text-gray-500 dark:text-dark-text-secondary truncate block">
            {contact.phoneNumber}
          </span>
        )}
      </div>
    </button>
  )
})

export default ForwardMessageDialog
