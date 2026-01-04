# Notification Flow

This document describes how notifications work in the WhatsApp Web collaborative platform.

## Overview

The notification system provides real-time alerts for WhatsApp messages, mentions, assignments, and team activities. It supports both browser desktop notifications and an in-app notification center.

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   WhatsApp      │    │      NATS       │    │   Hono API      │    │   React App     │
│   (Go Service)  │───▶│   JetStream     │───▶│   WebSocket     │───▶│   Browser       │
└─────────────────┘    └─────────────────┘    └─────────────────┘    └─────────────────┘
                                                      │                        │
                                                      ▼                        ▼
                                               ┌─────────────┐         ┌─────────────┐
                                               │ PostgreSQL  │         │ In-App      │
                                               │ (Tenant DB) │         │ Notification│
                                               └─────────────┘         └─────────────┘
```

## Notification Types

| Type | Description |
|------|-------------|
| `message` | New WhatsApp messages received |
| `mention` | User mentioned in messages/groups |
| `assignment` | Contact assignment notifications |
| `team` | Team-related notifications |
| `system` | System notifications |

## Architecture

### Backend (Hono API)

#### Database Schema

Per-tenant schema tables:

**`notification_preferences`**
- Stores user notification settings
- Sound preferences (5 options: default, chime, bell, pop, none)
- Quiet hours configuration (default: 22:00-07:00)
- Muted contacts list

**`notification_history`**
- In-app notification center records
- Read/unread status tracking
- JSONB metadata for flexible data
- Indexed for performance

#### API Routes (`/api/notifications`)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/preferences` | Get user notification preferences |
| PATCH | `/preferences` | Update notification preferences |
| POST | `/mute` | Mute a contact |
| POST | `/unmute` | Unmute a contact |
| GET | `/notifications` | List notifications (paginated) |
| GET | `/count` | Get unread notification count |
| GET | `/:id` | Get single notification |
| POST | `/` | Create notification (internal) |
| PATCH | `/:id/read` | Mark as read |
| POST | `/read-all` | Mark all as read |
| DELETE | `/:id` | Delete notification |

#### Services

- **`notification-history.service.ts`** - CRUD operations for notification history
- **`notification-preferences.service.ts`** - User preferences with defaults

### Frontend (React)

#### Core Files

| File | Purpose |
|------|---------|
| `lib/notifications.ts` | Browser notification service |
| `hooks/useNotifications.ts` | React hook for notification state |
| `hooks/useNotificationCenter.ts` | React Query integration |
| `components/notifications/NotificationCenter.tsx` | In-app notification UI |

#### Browser Notification Service

Handles:
- Browser permission requests
- Quiet hours filtering
- Sound management
- Contact muting
- Desktop notification display

#### In-App Notification Center

Popover-based UI featuring:
- Real-time unread count badge
- Color-coded notification types
- Mark as read/delete actions
- Time-based display ("5m ago", "2h ago")

## Flow Diagram

### 1. Incoming Message Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              MESSAGE RECEIVED                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  1. Go WhatsApp Service receives message from WhatsApp                        │
│     - Uses whatsmeow library                                                  │
│     - Publishes event to NATS JetStream                                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  2. Hono API Message Handler (message-handler.ts)                           │
│     - Subscribes to NATS events                                              │
│     - Stores message to PostgreSQL (tenant schema)                           │
│     - Calls broadcastToCompany(connectionId, message)                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  3. WebSocket Broadcast (ws.ts)                                             │
│     - Finds all connections for the company                                  │
│     - Sends WebSocket message to all connected clients                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  4. Frontend WebSocket Handler                                              │
│     - Receives message event                                                 │
│     - useNotifications hook processes the event                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
          ┌─────────────────────┐         ┌─────────────────────┐
          │  NOTIFICATION CHECK  │         │  UI UPDATE          │
          │  - Is own message?   │         │  - Update chat      │
          │  - Is contact muted? │         │  - Update message   │
          │  - In quiet hours?   │         │    list            │
          │  - Page focused?     │         └─────────────────────┘
          └─────────────────────┘                    │
                    │                               │
                    ▼                               │
          ┌─────────────────────┐                    │
          │  SHOW NOTIFICATION   │                    │
          │  - Browser desktop   │                    │
          │    notification      │                    │
          │  - Play sound        │                    │
          │  - Add to in-app     │                    │
          │    notification      │                    │
          │    center            │                    │
          └─────────────────────┘                    │
                    │                               │
                    └───────────────┬───────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  5. User Interaction                                                         │
│     - Click notification → Navigate to chat                                  │
│     - Open NotificationCenter → View all notifications                       │
│     - Mark as read / Delete                                                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2. WebSocket Message Format

```typescript
{
  type: "message:new" | "receipt" | "connected" | "disconnected",
  connectionId: string,
  payload: {
    message: Message,
    conversationId: string
  },
  timestamp: string
}
```

### 3. Notification Display Logic

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          DISPLAY DECISION TREE                               │
└─────────────────────────────────────────────────────────────────────────────┘

  Message Received
        │
        ▼
  ┌─────────────┐
  │ Is own      │──── Yes ───▶  Don't show (you sent it)
  │ message?    │
  └─────────────┘
        │ No
        ▼
  ┌─────────────┐
  │ Contact     │──── Yes ───▶  Don't show (user muted)
  │ muted?      │
  └─────────────┘
        │ No
        ▼
  ┌─────────────┐
  │ In quiet    │──── Yes ───▶  Don't show (silent hours)
  │ hours?      │
  └─────────────┘
        │ No
        ▼
  ┌─────────────┐
  │ Page        │──── Yes ───▶  In-app notification only
  │ focused?    │
  └─────────────┘
        │ No
        ▼
  Browser notification + In-app notification
```

## Key Features

### Notification Controls

| Feature | Description |
|---------|-------------|
| Sound Settings | 5 sound options: default, chime, bell, pop, none |
| Quiet Hours | Automatic muting 22:00-07:00 (configurable) |
| Contact Muting | Individual contact notification silencing |
| Browser Permissions | Request/grant system for desktop notifications |

### UI/UX Features

| Feature | Description |
|---------|-------------|
| Unread Badge | Animated count indicator on notification bell |
| Type Styling | Different colors/icons per notification type |
| Real-time Updates | WebSocket-connected for instant notifications |
| Optimistic Updates | UI responds immediately before API confirmation |
| Time Display | Relative time formatting ("5m ago", "2h ago") |

## Security & Privacy

- JWT authentication for WebSocket connections
- Company-scoped message broadcasting (no cross-tenant leaks)
- User can only see their own notifications
- Contact-level muting preferences stored per user

## Performance Optimizations

- Database indexing on notification tables
- React Query caching (30-second stale time)
- WebSocket connection pooling by company
- Efficient unread count queries
- Browser notification permission caching

## Currently Not Implemented

| Feature | Status |
|---------|--------|
| Push Notifications (Firebase/FCM) | Not implemented |
| Email Notifications | Not implemented |
| SMS Notifications | Not implemented |
| Mobile App Notifications | Not implemented |

## Files Reference

### Backend

- `apps/api/src/routes/notifications.ts` - API routes
- `apps/api/src/routes/ws.ts` - WebSocket handler
- `apps/api/src/services/message-handler.ts` - Message processing
- `apps/api/src/services/notification-history.service.ts` - History CRUD
- `apps/api/src/services/notification-preferences.service.ts` - Preferences
- `packages/database/src/migrations/*.ts` - Database schema

### Frontend

- `apps/web/src/lib/notifications.ts` - Browser notification service
- `apps/web/src/hooks/useNotifications.ts` - Notification state hook
- `apps/web/src/hooks/useNotificationCenter.ts` - React Query integration
- `apps/web/src/components/notifications/NotificationCenter.tsx` - In-app UI
- `apps/web/src/components/notifications/NotificationItem.tsx` - Notification item
- `apps/web/src/components/notifications/NotificationBell.tsx` - Bell icon with badge
