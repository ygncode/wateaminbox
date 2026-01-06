import { dayjs } from '@whatsapp-web/shared'
import type { Chat, Contact, Message } from '../types/chat'

/**
 * Mock contacts for development
 */
export const mockContacts: Contact[] = [
  {
    id: 'contact-1',
    phoneNumber: '+1234567890',
    name: 'Alice Johnson',
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=alice',
    isOnline: true,
    about: 'Available',
  },
  {
    id: 'contact-2',
    phoneNumber: '+1234567891',
    name: 'Bob Smith',
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=bob',
    isOnline: false,
    lastSeen: dayjs().subtract(30, 'minute').toDate(), // 30 minutes ago
    about: 'At work',
  },
  {
    id: 'contact-3',
    phoneNumber: '+1234567892',
    name: 'Carol Williams',
    customName: 'Carol (Marketing)',
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=carol',
    isOnline: true,
    about: "Hey there! I'm using WhatsApp",
  },
  {
    id: 'contact-4',
    phoneNumber: '+1234567893',
    name: 'David Brown',
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=david',
    isOnline: false,
    lastSeen: dayjs().subtract(2, 'hour').toDate(), // 2 hours ago
    about: 'Busy',
  },
  {
    id: 'contact-5',
    phoneNumber: '+1234567894',
    name: 'Emma Davis',
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=emma',
    isOnline: true,
    about: 'On vacation until next week',
  },
  {
    id: 'contact-6',
    phoneNumber: '+1234567895',
    name: 'Frank Miller',
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=frank',
    isOnline: false,
    lastSeen: dayjs().subtract(1, 'day').toDate(), // 1 day ago
  },
  {
    id: 'contact-7',
    phoneNumber: '+1234567896',
    name: 'Grace Wilson',
    customName: 'Grace (Support)',
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=grace',
    isOnline: true,
    about: 'Customer support lead',
  },
  {
    id: 'contact-8',
    phoneNumber: '+1234567897',
    name: 'Henry Taylor',
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=henry',
    isOnline: false,
    lastSeen: dayjs().subtract(5, 'minute').toDate(), // 5 minutes ago
    about: 'Be right back',
  },
]

/**
 * Mock messages for development
 */
export const mockMessages: Message[] = [
  {
    id: 'msg-1',
    chatId: 'chat-1',
    senderId: 'contact-1',
    content: "Hey! How's the project going?",
    type: 'text',
    status: 'read',
    timestamp: dayjs().subtract(2, 'minute').toDate(), // 2 minutes ago
    isFromMe: false,
  },
  {
    id: 'msg-2',
    chatId: 'chat-2',
    senderId: 'me',
    content: "I'll send you the report by end of day",
    type: 'text',
    status: 'delivered',
    timestamp: dayjs().subtract(15, 'minute').toDate(), // 15 minutes ago
    isFromMe: true,
  },
  {
    id: 'msg-3',
    chatId: 'chat-3',
    senderId: 'contact-3',
    content: 'The marketing campaign is ready for review!',
    type: 'text',
    status: 'read',
    timestamp: dayjs().subtract(45, 'minute').toDate(), // 45 minutes ago
    isFromMe: false,
  },
  {
    id: 'msg-4',
    chatId: 'chat-4',
    senderId: 'contact-4',
    content: 'Meeting moved to 3 PM',
    type: 'text',
    status: 'read',
    timestamp: dayjs().subtract(2, 'hour').toDate(), // 2 hours ago
    isFromMe: false,
  },
  {
    id: 'msg-5',
    chatId: 'chat-5',
    senderId: 'me',
    content: 'Have a great vacation! See you when you get back.',
    type: 'text',
    status: 'read',
    timestamp: dayjs().subtract(5, 'hour').toDate(), // 5 hours ago
    isFromMe: true,
  },
  {
    id: 'msg-6',
    chatId: 'chat-6',
    senderId: 'contact-6',
    content: 'Thanks for your help yesterday!',
    type: 'text',
    status: 'read',
    timestamp: dayjs().subtract(1, 'day').toDate(), // 1 day ago
    isFromMe: false,
  },
  {
    id: 'msg-7',
    chatId: 'chat-7',
    senderId: 'contact-7',
    content: "Customer issue resolved. They're happy now!",
    type: 'text',
    status: 'read',
    timestamp: dayjs().subtract(26, 'hour').toDate(), // 26 hours ago
    isFromMe: false,
  },
  {
    id: 'msg-8',
    chatId: 'chat-8',
    senderId: 'me',
    content: "Sure, I'll check and get back to you",
    type: 'text',
    status: 'sent',
    timestamp: dayjs().subtract(2, 'day').toDate(), // 2 days ago
    isFromMe: true,
  },
]

/**
 * Mock chats combining contacts and their last messages
 */
export const mockChats: Chat[] = [
  {
    id: 'chat-1',
    contact: mockContacts[0],
    lastMessage: mockMessages[0],
    unreadCount: 3,
    isPinned: true,
    isMuted: false,
    isArchived: false,
    updatedAt: mockMessages[0].timestamp,
  },
  {
    id: 'chat-2',
    contact: mockContacts[1],
    lastMessage: mockMessages[1],
    unreadCount: 0,
    isPinned: true,
    isMuted: false,
    isArchived: false,
    updatedAt: mockMessages[1].timestamp,
  },
  {
    id: 'chat-3',
    contact: mockContacts[2],
    lastMessage: mockMessages[2],
    unreadCount: 1,
    isPinned: false,
    isMuted: false,
    isArchived: false,
    updatedAt: mockMessages[2].timestamp,
  },
  {
    id: 'chat-4',
    contact: mockContacts[3],
    lastMessage: mockMessages[3],
    unreadCount: 0,
    isPinned: false,
    isMuted: true,
    isArchived: false,
    updatedAt: mockMessages[3].timestamp,
  },
  {
    id: 'chat-5',
    contact: mockContacts[4],
    lastMessage: mockMessages[4],
    unreadCount: 0,
    isPinned: false,
    isMuted: false,
    isArchived: false,
    updatedAt: mockMessages[4].timestamp,
  },
  {
    id: 'chat-6',
    contact: mockContacts[5],
    lastMessage: mockMessages[5],
    unreadCount: 0,
    isPinned: false,
    isMuted: false,
    isArchived: false,
    updatedAt: mockMessages[5].timestamp,
  },
  {
    id: 'chat-7',
    contact: mockContacts[6],
    lastMessage: mockMessages[6],
    unreadCount: 2,
    isPinned: false,
    isMuted: false,
    isArchived: false,
    updatedAt: mockMessages[6].timestamp,
  },
  {
    id: 'chat-8',
    contact: mockContacts[7],
    lastMessage: mockMessages[7],
    unreadCount: 0,
    isPinned: false,
    isMuted: false,
    isArchived: false,
    updatedAt: mockMessages[7].timestamp,
  },
]

/**
 * Simulates API delay for realistic loading states
 */
export const simulateApiDelay = (ms: number = 500): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Fetches mock chats with simulated API delay
 */
export const fetchMockChats = async (): Promise<Chat[]> => {
  await simulateApiDelay()
  return [...mockChats].sort((a, b) => {
    // Pinned chats first, then sort by updatedAt
    if (a.isPinned && !b.isPinned) return -1
    if (!a.isPinned && b.isPinned) return 1
    return b.updatedAt.getTime() - a.updatedAt.getTime()
  })
}

/**
 * Search chats by contact name or phone number
 */
export const searchMockChats = async (query: string): Promise<Chat[]> => {
  await simulateApiDelay(300)
  const normalizedQuery = query.toLowerCase().trim()

  if (!normalizedQuery) {
    return fetchMockChats()
  }

  const filteredChats = mockChats.filter((chat) => {
    const contact = chat.contact
    const displayName = contact.customName || contact.name
    return (
      displayName.toLowerCase().includes(normalizedQuery) ||
      contact.phoneNumber.includes(normalizedQuery)
    )
  })

  return filteredChats.sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1
    if (!a.isPinned && b.isPinned) return 1
    return b.updatedAt.getTime() - a.updatedAt.getTime()
  })
}
