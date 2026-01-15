# WebSocket Architecture

This document describes the complete WebSocket implementation for real-time communication between the frontend, backend API, and Go services.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Browser (React App)                                  │
│  apps/web/                                                                   │
│  - WebSocketClient class                                                     │
│  - useWebSocket() hook                                                       │
│  - WebSocketProvider context                                                 │
│  - Zustand store for state                                                   │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
               WebSocket Protocol (wss://)
               Token + Company ID authentication
                               │
┌──────────────────────────────▼──────────────────────────────────────────────┐
│                    BACKEND API (Hono + Bun)                                  │
│  apps/api/src/routes/ws/                                                     │
│  - WebSocket upgrade handler                                                 │
│  - Connection pool (per-company)                                             │
│  - Authentication middleware                                                 │
│  - Message routing                                                           │
│  - Server-side heartbeat                                                     │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
             NATS JetStream (WHATSAPP.events.*)
                               │
┌──────────────────────────────▼──────────────────────────────────────────────┐
│                    GO SERVICES                                               │
│  services/orchestrator/ - Worker lifecycle management                        │
│  services/whatsapp/ - WhatsApp client (whatsmeow)                           │
│  - Publishes events to NATS                                                  │
│  - Receives commands from NATS                                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Backend WebSocket Setup

### 1.1 Route Configuration

**Location:** `apps/api/src/routes/ws/index.ts`

The WebSocket endpoint is available at:

```
GET /api/ws?token=JWT_TOKEN&company=COMPANY_ID
```

Query parameters:
- `token`: JWT access token for authentication
- `company`: Company ID for multi-tenancy

### 1.2 Connection Lifecycle

```typescript
// WebSocket upgrade handler
app.get('/ws', (c) => {
  return upgradeWebSocket(c, {
    onOpen: (evt, ws) => {
      // Authenticate if token provided in query
      // Add to connection pool
    },
    onMessage: (evt, ws) => {
      // Route to appropriate handler
    },
    onClose: (evt, ws) => {
      // Remove from connection pool
      // Cleanup resources
    },
    onError: (evt, ws) => {
      // Log error
    }
  })
})
```

### 1.3 Authentication

**Location:** `apps/api/src/routes/ws/auth.ts`

```typescript
authenticateConnection(ws: WSContext, token: string, companyId: string)
    │
    ├─ Verify JWT with verifyAccessToken()
    │
    ├─ Confirm user exists in database
    │
    ├─ Verify user belongs to company
    │
    ├─ Set ws.data:
    │   ├─ userId
    │   ├─ companyId
    │   └─ authenticated = true
    │
    └─ Send auth_success or auth_error event
```

### 1.4 Connection Pool

**Location:** `apps/api/src/routes/ws/connection.ts`

```typescript
// Global connection pool (per-company)
const connections: Map<string, Set<WebSocket>>

// Add connection
addConnection(companyId: string, ws: WebSocket)

// Remove connection
removeConnection(companyId: string, ws: WebSocket)

// Broadcast to all clients in a company
broadcastToCompany(companyId: string, message: WebSocketMessage)
```

### 1.5 Message Handlers

**Location:** `apps/api/src/routes/ws/handlers.ts`

Client-to-server message types:

| Message Type   | Description                    |
| -------------- | ------------------------------ |
| `auth`         | Authenticate via message       |
| `ping`         | Heartbeat request              |
| `send_message` | Send WhatsApp message via NATS |

### 1.6 Server-Side Heartbeat

**Location:** `apps/api/src/routes/ws/heartbeat.ts`

```
Server heartbeat configuration:
├─ Ping interval: 45 seconds
├─ Pong timeout: 15 seconds
│
└─ If no pong received → close connection
```

---

## 2. Frontend WebSocket Client

### 2.1 WebSocketClient Class

**Location:** `apps/web/src/lib/websocket.ts`

Core class providing:

- **Event Management**: Typed event subscriptions
- **Automatic Reconnection**: Exponential backoff
- **Heartbeat**: Client-side ping/pong
- **Message Queue**: Queue messages during connection
- **Metrics**: Connection health tracking

```typescript
const client = new WebSocketClient({
  url: 'wss://api.example.com/ws',
  token: accessToken,
  companyId: companyId,
})

// Connect
client.connect()

// Subscribe to events
client.on('message:new', (payload) => {
  console.log('New message:', payload)
})

// Send message
client.send('send_message', { to: jid, content: 'Hello' })

// Disconnect
client.disconnect()
```

### 2.2 Configuration Defaults

| Setting              | Default | Description                 |
| -------------------- | ------- | --------------------------- |
| `maxReconnectAttempts` | 15      | Max reconnection attempts   |
| `baseReconnectDelay`   | 1000ms  | Initial reconnect delay     |
| `maxReconnectDelay`    | 30000ms | Maximum reconnect delay     |
| `heartbeatInterval`    | 30000ms | Ping interval               |
| `pongTimeout`          | 5000ms  | Pong response timeout       |
| `connectionTimeout`    | 10000ms | Initial connection timeout  |

### 2.3 Supporting Modules

**HeartbeatManager** (`apps/web/src/lib/websocket/heartbeat.ts`)
- Sends periodic pings
- Tracks latency
- Triggers reconnect on timeout

**ReconnectManager** (`apps/web/src/lib/websocket/reconnect.ts`)
- Exponential backoff with jitter
- Tracks attempt count
- Respects max attempts

**MessageQueue** (`apps/web/src/lib/websocket/queue.ts`)
- Queues messages while connecting
- Flushes on successful connection
- Preserves message order

---

## 3. Frontend Hooks & State

### 3.1 useWebSocket Hook

**Location:** `apps/web/src/hooks/useWebSocket.ts`

```typescript
const {
  status,        // 'connecting' | 'connected' | 'disconnected' | 'reconnecting'
  isConnected,   // boolean
  connect,       // () => void
  disconnect,    // () => void
  send,          // (type, payload) => void
  subscribe,     // (event, handler) => unsubscribe
} = useWebSocket()
```

### 3.2 useWebSocketConnection

**Location:** `apps/web/src/hooks/useWebSocketConnection.ts`

Low-level hook for WebSocket client initialization:
- Creates WebSocketClient instance
- Manages lifecycle
- Handles token updates

### 3.3 useWebSocketEvents

**Location:** `apps/web/src/hooks/useWebSocketEvents.ts`

Sets up event subscriptions:
- Registers handlers for server events
- Cleans up on unmount
- Updates React Query cache

### 3.4 useTypingIndicators

**Location:** `apps/web/src/hooks/useTypingIndicators.ts`

Manages typing indicator state:
- Debounced typing notifications (5s timeout)
- Tracks per-contact typing state
- Auto-clears stale indicators

### 3.5 Zustand Store

**Location:** `apps/web/src/stores/websocket-store.ts`

```typescript
interface WebSocketState {
  status: ConnectionStatus
  error: Error | null
  connectedAt: Date | null
  reconnectAttempts: number

  // Actions
  setStatus: (status) => void
  setError: (error) => void
  reset: () => void
}
```

### 3.6 WebSocketProvider

**Location:** `apps/web/src/contexts/WebSocketProvider.tsx`

Context provider that:
- Manages WebSocket lifecycle
- Handles auto-reconnection
- Refreshes tokens on 401
- Tracks sync progress
- Provides WebSocket client to children

---

## 4. Event Types & Message Formats

### 4.1 Shared Types

**Location:** `packages/shared/src/websocket-types.ts`

### 4.2 Server → Client Events

**Authentication:**

| Event          | Payload                          | Description           |
| -------------- | -------------------------------- | --------------------- |
| `auth_success` | `{ userId }`                     | Auth succeeded        |
| `auth_error`   | `{ error }`                      | Auth failed           |

**Connection:**

| Event              | Payload                              | Description                       |
| ------------------ | ------------------------------------ | --------------------------------- |
| `qr`               | `{ qrCode, expiration }`             | QR code for pairing               |
| `connected`        | `{ phoneNumber }`                    | WhatsApp connected                |
| `disconnected`     | `{ reason }`                         | WhatsApp disconnected             |
| `connection:status`| `{ connectionId, status, reason }`   | Worker connection status changed  |

**Messages:**

| Event              | Payload                              | Description               |
| ------------------ | ------------------------------------ | ------------------------- |
| `message:new`      | `{ message, contact }`               | New message received      |
| `message:status`   | `{ messageId, status }`              | Status update             |
| `message:deleted`  | `{ messageId }`                      | Message revoked           |
| `message:reaction` | `{ messageId, emoji, reactorJid }`   | Reaction added/removed    |
| `send_ack`         | `{ tempId, messageId }`              | Send confirmation         |

**Conversations:**

| Event                  | Payload                          | Description             |
| ---------------------- | -------------------------------- | ----------------------- |
| `conversation:updated` | `{ contactId, lastMessage, unreadCount }` | Conversation update |
| `conversation:read`    | `{ contactId }`                  | Marked as read          |

**Contacts:**

| Event                    | Payload                      | Description             |
| ------------------------ | ---------------------------- | ----------------------- |
| `contact`                | `{ contact }`                | Contact created/updated |
| `contact:profile_picture`| `{ jid, url }`               | Profile picture updated |

**Presence:**

| Event             | Payload                      | Description             |
| ----------------- | ---------------------------- | ----------------------- |
| `presence:online` | `{ jid }`                    | Contact came online     |
| `presence:offline`| `{ jid, lastSeen }`          | Contact went offline    |

**Typing:**

| Event          | Payload                      | Description             |
| -------------- | ---------------------------- | ----------------------- |
| `typing:start` | `{ jid }`                    | Contact started typing  |
| `typing:stop`  | `{ jid }`                    | Contact stopped typing  |

**Media:**

| Event                  | Payload                      | Description             |
| ---------------------- | ---------------------------- | ----------------------- |
| `media:downloaded`     | `{ messageId, url }`         | Media download complete |
| `media:download_failed`| `{ messageId, error }`       | Media download failed   |

**Sync:**

| Event             | Payload                           | Description             |
| ----------------- | --------------------------------- | ----------------------- |
| `sync:start`      | `{ connectionId }`                | History sync started    |
| `sync:progress`   | `{ processed, total, percent }`   | Sync progress update    |
| `sync:complete`   | `{ totalMessages, totalContacts }`| Sync completed          |
| `sync:interrupted`| `{ reason }`                      | Sync interrupted        |

**System:**

| Event     | Payload                      | Description             |
| --------- | ---------------------------- | ----------------------- |
| `error`   | `{ code, message }`          | Error occurred          |
| `pong`    | `{ timestamp }`              | Heartbeat response      |
| `status`  | `{ status }`                 | Connection status       |

**Notifications:**

| Event               | Payload                          | Description             |
| ------------------- | -------------------------------- | ----------------------- |
| `notification:toast`| `{ type, title, message }`       | Show toast notification |

The `notification:toast` event is used to display toast notifications to the user, e.g., when a worker crashes or recovers. The `type` field can be `error`, `success`, `warning`, or `info`.

### 4.3 Client → Server Messages

| Message Type   | Payload                          | Description              |
| -------------- | -------------------------------- | ------------------------ |
| `auth`         | `{ token, companyId }`           | Authenticate connection  |
| `ping`         | `{}`                             | Heartbeat request        |
| `send_message` | `{ to, content, messageType }`   | Send WhatsApp message    |

### 4.4 Message Structure

```typescript
// Server → Client
interface ServerMessage {
  type: ServerToClientEventType
  payload?: unknown
  timestamp: string
  connectionId?: string
}

// Client → Server
interface ClientMessage {
  type: ClientToServerEventType
  payload?: unknown
}
```

---

## 5. Go Services Integration

### 5.1 NATS Subject Pattern

```
WHATSAPP.commands                           # Commands to workers
WHATSAPP.events.{companyId}.{connectionId}.{type}  # Events from workers
WHATSAPP.download.{companyId}.{connectionId}.*     # Media download requests
```

### 5.2 Go Services

**Orchestrator** (`services/orchestrator/`)
- Manages WhatsApp worker lifecycle
- Spawns/kills workers on demand
- Health monitoring (detects dead workers)
- Publishes `connection_status` events when workers crash or recover
- Auto-restart with exponential backoff

**WhatsApp Worker** (`services/whatsapp/`)
- Uses whatsmeow library
- One process per WhatsApp connection
- Publishes all WhatsApp events to NATS

### 5.3 Event Publishing

```go
// services/whatsapp/internal/nats/publisher.go
// WhatsApp worker publishes message events

func (p *Publisher) PublishMessage(msg MessagePayload) error {
    subject := fmt.Sprintf("WHATSAPP.events.%s.%s.message",
        p.companyID, p.connectionID)
    return p.js.Publish(subject, msg)
}
```

```go
// services/orchestrator/internal/manager/handlers.go
// Orchestrator publishes connection_status events on worker failure/recovery

func (h *Handlers) PublishConnectionStatus(companyID, connectionID, status, reason string) {
    event := sharednats.WhatsAppEvent{
        Type:         sharednats.EventTypeConnectionStatus,
        CompanyID:    companyID,
        ConnectionID: connectionID,
        Payload: sharednats.ConnectionStatusPayload{
            Status: status,
            Reason: reason,
        },
        Timestamp: time.Now().Format(time.RFC3339),
    }
    subject := fmt.Sprintf(sharednats.SubjectConnectionStatus, companyID, connectionID)
    h.nats.PublishEvent(subject, data)
}
```

### 5.4 Shared Types

**Location:** `services/shared/nats/events.go`

```go
type WhatsAppEvent struct {
    Type         string      `json:"type"`
    CompanyID    string      `json:"companyId"`
    ConnectionID string      `json:"connectionId"`
    Payload      interface{} `json:"payload"`
    Timestamp    string      `json:"timestamp"`
}
```

---

## 6. Complete Message Flow Examples

### 6.1 Incoming Message

```
1. WhatsApp Server sends message
       │
       ▼
2. Go Worker (whatsmeow) receives message
       │
       ▼
3. Worker publishes to NATS:
   Subject: WHATSAPP.events.{companyId}.{connectionId}.message
       │
       ▼
4. Backend API receives NATS event
       │
       ▼
5. handleMessageEvent():
   ├─ Get/create contact
   ├─ Insert message to DB
   └─ Index in Meilisearch
       │
       ▼
6. broadcastToCompany():
   Event: message:new
       │
       ▼
7. All WebSocket clients receive event
       │
       ▼
8. Frontend updates UI via React Query
```

### 6.2 Outgoing Message

```
1. User types message and clicks send
       │
       ▼
2. Frontend calls send('send_message', {...})
       │
       ▼
3. WebSocket sends to backend
       │
       ▼
4. Backend publishes to NATS:
   Subject: WHATSAPP.commands
       │
       ▼
5. Go Worker receives command
       │
       ▼
6. Worker sends via WhatsApp API
       │
       ▼
7. Worker publishes send_confirmation to NATS
       │
       ▼
8. Backend broadcasts: send_ack
       │
       ▼
9. Frontend shows sent indicator (✓)
       │
       ▼
10. WhatsApp sends delivery receipt
       │
       ▼
11. Worker publishes receipt to NATS
       │
       ▼
12. Backend broadcasts: message:status
       │
       ▼
13. Frontend shows delivered indicator (✓✓)
```

### 6.3 Connection Flow

```
1. User opens app
       │
       ▼
2. WebSocketProvider initializes
       │
       ▼
3. WebSocketClient.connect():
   URL: wss://api/ws?token=JWT&company=ID
       │
       ▼
4. Server receives upgrade request
       │
       ▼
5. authenticateConnection():
   ├─ Verify JWT
   ├─ Check user exists
   └─ Verify company membership
       │
       ▼
6. Add to connection pool
       │
       ▼
7. Send auth_success event
       │
       ▼
8. Client receives auth_success
       │
       ▼
9. Start heartbeat loop
       │
       ▼
10. Flush queued messages
```

### 6.4 Reconnection Flow

```
1. Connection lost (network, server restart)
       │
       ▼
2. Client detects disconnection
       │
       ▼
3. ReconnectManager starts:
   ├─ Attempt 1: wait 1s
   ├─ Attempt 2: wait 2s
   ├─ Attempt 3: wait 4s
   └─ ... (exponential backoff with jitter)
       │
       ▼
4. On 401 error:
   └─ Refresh access token
       │
       ▼
5. Re-establish connection
       │
       ▼
6. Re-register event handlers
       │
       ▼
7. Update connection status
```

### 6.5 Worker Crash & Auto-Recovery Flow

```
1. WhatsApp worker process crashes/dies
       │
       ▼
2. Orchestrator health check detects dead process
   (checks every 30 seconds via signal 0)
       │
       ▼
3. Orchestrator calls handleWorkerFailure():
   ├─ Update worker status to "error"
   └─ Publish connection_status event to NATS
       │
       ▼
4. Backend API receives NATS event:
   Subject: WHATSAPP.events.{companyId}.{connectionId}.connection_status
       │
       ▼
5. handleWorkerConnectionStatusEvent():
   ├─ Update whatsapp_connections.status = "disconnected"
   └─ broadcastToCompany("connection:status")
       │
       ▼
6. Frontend receives WebSocket event
       │
       ▼
7. useWhatsAppConnectionWebSocket handles event:
   ├─ Show toast notification: "WhatsApp disconnected"
   ├─ Show yellow banner in MessageComposer
   └─ Disable message input
       │
       ▼
8. If AUTO_RESTART_ENABLED:
   ├─ Wait backoff (5s → 10s → 20s → 40s → 80s)
   ├─ Increment restart_count in worker_registry
   └─ Spawn new worker process
       │
       ▼
9. New worker connects to WhatsApp
       │
       ▼
10. Status updates to "connected", UI recovers
```

---

## 7. Multi-Tenancy

### 7.1 Company Isolation

- Each company has its own connection pool
- Broadcasting only reaches clients of the same company
- Company ID verified during authentication

### 7.2 Connection Pool Structure

```typescript
// Map<companyId, Set<WebSocket>>
{
  "company-1": Set([ws1, ws2, ws3]),
  "company-2": Set([ws4, ws5]),
  "company-3": Set([ws6])
}
```

---

## 8. Error Handling

### 8.1 Client-Side Errors

| Error Type        | Handling                           |
| ----------------- | ---------------------------------- |
| Connection failed | Exponential backoff reconnect      |
| Auth error (401)  | Refresh token, then reconnect      |
| Pong timeout      | Force reconnect                    |
| Parse error       | Log and ignore malformed message   |

### 8.2 Server-Side Errors

| Error Type          | Handling                         |
| ------------------- | -------------------------------- |
| Invalid token       | Send auth_error, close connection|
| Company not found   | Send auth_error, close connection|
| Message parse error | Log error, continue              |
| NATS unavailable    | Retry with backoff               |

---

## 9. Metrics & Monitoring

### 9.1 Client Metrics

```typescript
client.getMetrics()
// {
//   latency: 45,           // Last ping latency (ms)
//   uptime: 3600000,       // Connection uptime (ms)
//   messagesSent: 150,
//   messagesReceived: 425,
//   reconnectAttempts: 2
// }
```

### 9.2 Server Metrics

- Connection count per company
- Total active connections
- Messages broadcast per second
- Authentication failures

---

## 10. Key Files Reference

### Backend

| File                                   | Purpose                    |
| -------------------------------------- | -------------------------- |
| `apps/api/src/routes/ws/index.ts`      | Main WebSocket route       |
| `apps/api/src/routes/ws/auth.ts`       | Authentication logic       |
| `apps/api/src/routes/ws/handlers.ts`   | Message routing            |
| `apps/api/src/routes/ws/connection.ts` | Connection pool management |
| `apps/api/src/routes/ws/heartbeat.ts`  | Server-side keep-alive     |

### Frontend

| File                                           | Purpose                   |
| ---------------------------------------------- | ------------------------- |
| `apps/web/src/lib/websocket.ts`                | WebSocketClient class     |
| `apps/web/src/lib/websocket/heartbeat.ts`      | Heartbeat manager         |
| `apps/web/src/lib/websocket/reconnect.ts`      | Reconnection logic        |
| `apps/web/src/lib/websocket/queue.ts`          | Message queue             |
| `apps/web/src/hooks/useWebSocket.ts`           | Main WebSocket hook       |
| `apps/web/src/hooks/useWebSocketConnection.ts` | Connection hook           |
| `apps/web/src/hooks/useWebSocketEvents.ts`     | Event subscription hook   |
| `apps/web/src/hooks/useTypingIndicators.ts`    | Typing state management   |
| `apps/web/src/stores/websocket-store.ts`       | Zustand state store       |
| `apps/web/src/contexts/WebSocketProvider.tsx`  | React context provider    |

### Shared

| File                                     | Purpose                 |
| ---------------------------------------- | ----------------------- |
| `packages/shared/src/websocket-types.ts` | TypeScript event types  |

### Go Services

| File                                      | Purpose                 |
| ----------------------------------------- | ----------------------- |
| `services/shared/nats/events.go`          | Event type definitions  |
| `services/shared/nats/subjects.go`        | NATS subject patterns   |
| `services/whatsapp/internal/nats/*.go`    | Event publishing        |
| `services/orchestrator/internal/nats/*.go`| Command handling        |

---

## Related Documentation

- [WhatsApp Connection Flow](./whatsapp-connection-flow.md) - Connection lifecycle and worker auto-recovery
- [WhatsApp Sync Flow](./whatsapp-sync-flow.md) - History sync and data persistence
