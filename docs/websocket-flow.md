# WebSocket Architecture & Flow

This document details the WebSocket implementation used for real-time updates in the platform. It covers the server-side broadcasting mechanism, client-side connection management, and the event-driven state update strategy.

## Overview

The system uses a **Company-scoped Broadcast** model. Users are authenticated via JWT and associated with a specific Company ID. Events triggered by backend services (e.g., incoming WhatsApp message) are broadcast to all active connections for that company.

## 1. Server-Side Implementation (`apps/api`)

The WebSocket server is built using `hono/bun`'s `createBunWebSocket` adapter.

### Connection Lifecycle (`src/routes/ws.ts`)

1.  **Upgrade**: HTTP requests to `/api/ws` are upgraded to WebSocket connections.
2.  **Authentication**:
    -   Clients must provide a valid JWT `token` and `companyId`.
    -   Authentication can happen via query params (initial connect) or an `auth` message.
    -   The server validates the token and ensures the user belongs to the requested company.
3.  **Tracking**:
    -   Valid connections are stored in a `Map<string, Set<ServerWebSocket>>` where the key is `companyId`.
    -   This allows efficient O(1) lookup for broadcasting to a specific company.
4.  **Heartbeat**:
    -   Server sends pings every 45 seconds to all connections.
    -   If no response within 15 seconds, the connection is marked as stale and closed.
    -   This ensures dead connections are cleaned up promptly.

### Server Connection Metrics

The health endpoint (`/api/health`) includes WebSocket connection metrics:

```typescript
// Response structure
{
  status: "ok",
  services: {
    websocket: {
      totalConnections: number,
      heartbeatRunning: boolean
    }
  }
}
```

For detailed metrics, use `/api/health/ws-metrics`:

```typescript
// Response structure
{
  timestamp: string,
  totalConnections: number,
  companiesConnected: number,
  connectionsPerCompany: [{ companyId: string, connections: number }],
  heartbeatRunning: boolean
}
```

### Broadcasting

The core broadcasting logic resides in `broadcastToCompany`:

```typescript
export function broadcastToCompany(companyId: string, message: ServerMessage): void {
  const companyConnections = connections.get(companyId);
  if (companyConnections) {
    const payload = JSON.stringify(message);
    for (const ws of companyConnections) {
      if (ws.readyState === 1) ws.send(payload);
    }
  }
}
```

Services across the API invoke this function to push updates. For example, when a new message is received from the Go service (via NATS), the message handler persists it to DB and then calls `broadcastToCompany`.

## 2. Client-Side Implementation (`apps/web`)

The frontend uses a singleton `WebSocketClient` managed by a React Context Provider.

### Architecture

-   **`WebSocketClient` (`lib/websocket.ts`)**: A robust class wrapping the native `WebSocket` API. It handles:
    -   Automatic reconnection (exponential backoff).
    -   Heartbeats (ping/pong) to detect stale connections.
    -   Message queueing (buffers messages while connecting).
    -   Type-safe event subscription (`on`, `off`, `once`).
    -   Connection metrics tracking (latency, reconnect count, uptime).
    -   Structured logging via configurable log levels.
-   **`WebSocketProvider` (`contexts/WebSocketProvider.tsx`)**:
    -   Initializes the client.
    -   Manages authentication tokens.
    -   Handles "Force Reconnect" when the user switches companies.
    -   Exposes `useWebSocketContext` for global state (connection status, sync progress).
-   **Event Handlers (`contexts/websocket/event-handlers.ts`)**:
    -   The "brain" of the realtime system.
    -   Centralizes logic for how the application state responds to events.

### Client Connection Metrics

The `WebSocketClient` tracks connection health metrics accessible via `getMetrics()`:

```typescript
interface WebSocketMetrics {
  latency: number | null;        // Round-trip time (ms) based on ping-pong
  reconnectCount: number;        // Number of reconnections this session
  connectedAt: number | null;    // Timestamp when connection was established
  uptime: number | null;         // Connection uptime (ms)
  lastError: { message: string; timestamp: number } | null;
  status: ConnectionStatus;      // 'connecting' | 'connected' | 'disconnected' | 'error'
  messagesSent: number;          // Messages sent this session
  messagesReceived: number;      // Messages received this session
}

// Usage in components
import { useWebSocketMetrics } from '@/contexts/WebSocketProvider';

function ConnectionStatus() {
  const metrics = useWebSocketMetrics();
  return <div>Latency: {metrics?.latency ?? 'N/A'}ms</div>;
}
```

### Logging

WebSocket logging uses a structured logger with configurable log levels:

-   **Log Levels**: `debug`, `info`, `warn`, `error`, `none`
-   **Configuration**: Set `VITE_WS_LOG_LEVEL` environment variable
-   **Default**: `warn` in production, `info` in development

```typescript
// Example log output
[WebSocket] [INFO] Connected - Realtime updates enabled
[WebSocket] [DEBUG] Latency: 45 ms
[WebSocket] [WARN] Pong timeout - connection may be stale
```

### State Update Strategy

We use a hybrid approach of **Direct Cache Manipulation** and **Query Invalidation** using TanStack Query.

#### Pattern A: Direct Cache Update (Optimistic/Real-time)
Used for high-frequency or critical data where we want immediate UI feedback without a network round-trip.

*Example: `message:new`*
1.  Receive payload with the full message object.
2.  **Zustand**: Update legacy chat store.
3.  **TanStack Query**:
    -   Find the specific infinite query cache for the conversation (`infiniteMessageKeys.list(conversationId)`).
    -   Manually inject the new message into the `pages` array via `queryClient.setQueryData`.
    -   **Result**: The message appears instantly in the chat window.

#### Pattern B: Invalidation (Refetch)
Used for derived state or lists where complex sorting/filtering makes direct updates risky.

*Example: `conversation:read`*
1.  Receive payload indicating a conversation was read.
2.  **TanStack Query**:
    -   Call `queryClient.invalidateQueries({ queryKey: chatKeys.lists() })`.
    -   **Result**: The chat list re-fetches from the API, updating the unread count badges and sorting order.

## Event Reference

| Event Type | Payload | Action |
| :--- | :--- | :--- |
| `message:new` | `message`, `conversationId` | Appends message to chat window cache. Invalidates chat list. |
| `message:status` | `messageId`, `status` | Updates status ticks (sent/delivered/read) in chat window cache. |
| `message:deleted` | `messageId` | Marks message as deleted in cache (soft delete). |
| `typing:start` | `userId`, `conversationId` | Shows typing indicator (ephemeral). |
| `contact:profile_picture` | `jid`, `url` | Updates avatar in chat list and header cache. |
| `presence:online/offline` | `jid`, `lastSeen` | Updates online status dot in chat list. |
| `sync:progress` | `conversations` | Updates the global sync progress bar. |
| `media:downloaded` | `mediaUrl` | Swaps loading placeholder with actual media URL in message cache. |

## Flow Diagrams

### 1. Incoming Message Flow

```mermaid
sequenceDiagram
    participant Go as WhatsApp Service
    participant API as Hono API
    participant DB as PostgreSQL
    participant WS as WebSocket Server
    participant Client as React Client (Query Cache)

    Go->>API: NATS: message.created
    API->>DB: Insert Message
    API->>WS: broadcastToCompany(companyId, { type: "message:new", payload: msg })
    WS->>Client: Send JSON Payload
    Client->>Client: queryClient.setQueryData(chatKey, msg)
    Note over Client: Message appears in UI instantly
    Client->>Client: queryClient.invalidateQueries(listKey)
    Client->>API: GET /api/conversations (Background Refetch)
```

### 2. Media Download Flow

```mermaid
sequenceDiagram
    participant Client
    participant API
    participant Go

    Go->>API: NATS: media.downloaded (S3 URL)
    API->>WS: broadcast("media:downloaded", { url })
    WS->>Client: Event { type: "media:downloaded", mediaUrl: "..." }
    Client->>Client: Find message in Cache
    Client->>Client: Update metadata.mediaUrl
    Note over Client: Image loads in UI
```
