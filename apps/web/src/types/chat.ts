/**
 * Chat-related type definitions for the WhatsApp Web application
 */

export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed'

export type MessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contact'

export interface Contact {
  id: string
  phoneNumber: string
  jid?: string
  name: string
  customName?: string
  avatarUrl?: string
  isOnline: boolean
  lastSeen?: Date
  about?: string
  isGroup?: boolean
}

export interface GroupInfo {
  id: string
  jid: string
  name: string
  displayName: string
  customName?: string
  description?: string
  profilePictureUrl?: string
  participantCount: number
  createdBy?: string
  createdAt: Date
  participants: GroupParticipant[]
}

export interface GroupParticipant {
  jid: string
  isAdmin: boolean
  joinedAt: Date
}

export interface Message {
  id: string
  chatId: string
  senderId: string
  content: string
  type: MessageType
  status: MessageStatus
  timestamp: Date
  isFromMe: boolean
  replyToId?: string
  isForwarded?: boolean
  isDeleted?: boolean
  mediaUrl?: string
  mediaCaption?: string
  mediaMimeType?: string
}

export interface Chat {
  id: string
  contact: Contact
  lastMessage?: Message
  unreadCount: number
  assignedTo?: string
  isPinned: boolean
  isMuted: boolean
  isArchived: boolean
  updatedAt: Date
}

export interface ChatListProps {
  selectedChatId?: string
  onChatSelect: (chatId: string) => void
  className?: string
}

export interface ChatListItemProps {
  chat: Chat
  isSelected: boolean
  onClick: () => void
}

export interface ChatListSearchProps {
  value: string
  onChange: (value: string) => void
  onClear: () => void
  placeholder?: string
}
