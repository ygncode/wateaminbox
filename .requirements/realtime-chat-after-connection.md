# Real-time Chat List After WhatsApp Connection

> Show a syncing overlay when WhatsApp connects, block user interaction until sync completes, then display contacts/chats in real-time.

## Background

When users add a new WhatsApp connection by scanning a QR code, the connected WhatsApp account syncs contacts and message history. Currently, after connection, users navigating to the Chat page don't see any contacts until they manually refresh. This creates a confusing experience where the connection shows as "connected" but the chat list appears empty.

The expected behavior (like WhatsApp Web) is to show a "syncing" state that blocks user interaction until the initial sync is complete, then reveal the chat list with all synced contacts.

## Current State

### Connection Flow
1. User clicks "Add Connection" in Settings → WhatsApp
2. QR code displayed via `WhatsAppConnectionPanel.tsx`
3. User scans with WhatsApp mobile app
4. `connected` WebSocket event received by `useWhatsAppConnection(s).ts`
5. Go service receives `HistorySync` events and processes contacts/messages
6. Backend creates contacts via `message-handler.ts:325-350`

### What's Missing
- **No sync status tracking**: The Go service handles `HistorySync` but doesn't emit sync progress/completion events
- **No `OfflineSyncCompleted` handling**: whatsmeow's sync completion event is not handled
- **Chat list not invalidated**: After `connected` event, `chatKeys.lists()` is never invalidated
- **No syncing UI**: No visual indicator that sync is in progress

### Key Files
| File | Current Behavior |
|------|------------------|
| `services/whatsapp/internal/handler/handler.go:180` | Handles `HistorySync` events but doesn't signal completion |
| `apps/web/src/hooks/useWhatsAppConnection(s).ts` | Handles `connected` but only invalidates WhatsApp status, not chats |
| `apps/web/src/contexts/WebSocketProvider.tsx` | No handler for sync status events |
| `apps/api/src/services/message-handler.ts` | No sync status tracking or broadcasting |
| `apps/api/src/routes/ws.ts:47-73` | `ServerMessage.type` doesn't include sync events |

## Requirements

### Must Have

- [ ] **Go Service: Handle sync events**
  - Add handler for `*events.OfflineSyncCompleted` in `handler.go`
  - Add handler for `*events.OfflineSyncPreview` to know sync is starting
  - Track sync state per connection (starting, in_progress, completed)
  - Publish sync status via NATS when sync starts and completes

- [ ] **API: Broadcast sync status**
  - Add new WebSocket event types: `sync:start`, `sync:progress`, `sync:complete`
  - Handle NATS sync status messages in `message-handler.ts`
  - Broadcast sync events to company WebSocket clients
  - Include `connectionId` in payload for multi-connection support

- [ ] **Frontend: Track sync status**
  - Add `SyncStatus` type: `'idle' | 'syncing' | 'completed'`
  - Add WebSocket handlers for `sync:start`, `sync:complete` in `WebSocketProvider.tsx`
  - Store sync status per connection in Zustand or React state
  - Invalidate `chatKeys.lists()` when sync completes

- [ ] **Frontend: Syncing overlay**
  - Create `SyncingOverlay` component with WhatsApp-like UI
  - Show full-screen overlay on `/chat` route when any connection is syncing
  - Block navigation/interaction during sync
  - Display progress indicator and "Syncing messages..." text
  - Auto-dismiss and reveal chat list when sync completes

- [ ] **Database: Track sync status (optional but recommended)**
  - Add `sync_status` column to `whatsapp_connections` table
  - Values: `null`, `syncing`, `completed`
  - Update on sync events for persistence across page reloads

### Should Have

- [ ] Handle edge case: User already on chat page when connection is added
- [ ] Show which connection is syncing in multi-connection scenarios

### Must Have (from Decisions)

- [ ] **Timeout fallback**: If sync doesn't complete in 5 minutes, show warning and allow user to proceed
- [ ] **HistorySync progress**: Track and display conversation count during sync (e.g., "Syncing... 50 conversations")
- [ ] **Block all connections**: If ANY connection is syncing, block access to chat page until ALL complete

### Out of Scope

- Per-conversation sync progress tracking
- Sync progress percentage (WhatsApp doesn't provide this)
- Retry logic for failed syncs (connection will reconnect automatically)
- Syncing indicator in mobile app (this is web-only)

## Technical Approach

### 1. Go Service Changes (`services/whatsapp/internal/handler/handler.go`)

```go
// Add new event cases
case *events.OfflineSyncPreview:
    h.handleOfflineSyncPreview(v)
case *events.OfflineSyncCompleted:
    h.handleOfflineSyncCompleted(v)

func (h *Handler) handleOfflineSyncPreview(evt *events.OfflineSyncPreview) {
    log.Printf("Sync starting: %d messages, %d notifications", evt.Messages, evt.Notifications)
    h.publisher.PublishSyncStatus("starting", evt.Total, 0)
}

func (h *Handler) handleOfflineSyncCompleted(evt *events.OfflineSyncCompleted) {
    log.Printf("Sync completed: %d events synced", evt.Count)
    h.publisher.PublishSyncStatus("completed", evt.Count, 0)
}

// Modify existing handleHistorySync to publish progress
func (h *Handler) handleHistorySync(evt *events.HistorySync) {
    conversations := evt.Data.GetConversations()
    // ... existing processing ...

    // Publish progress after processing batch
    h.publisher.PublishSyncStatus("progress", totalMessages, len(conversations))
}
```

### 2. NATS Publisher Changes (`services/whatsapp/internal/nats/publisher.go`)

```go
// Add new subject and method
const SubjectSyncStatus = "whatsapp.%s.%s.sync_status"

type SyncStatusPayload struct {
    Status        string `json:"status"`        // "starting", "progress", "completed"
    Count         int    `json:"count"`         // Total events/messages count
    Conversations int    `json:"conversations"` // Number of conversations synced (for progress)
}

func (p *Publisher) PublishSyncStatus(status string, count int, conversations int) error {
    // Publish to NATS
}
```

### 3. API Message Handler (`apps/api/src/services/message-handler.ts`)

```typescript
// Add sync status handler
async function handleSyncStatusEvent(event: SyncStatusEvent): Promise<void> {
  const { companyId, connectionId, payload } = event

  // Update database (only for starting/completed, not progress)
  if (payload.status !== 'progress') {
    await updateConnectionSyncStatus(tenantDb, connectionId, payload.status)
  }

  // Map status to WebSocket event type
  const typeMap = {
    starting: 'sync:start',
    progress: 'sync:progress',
    completed: 'sync:complete',
  }

  // Broadcast to WebSocket
  broadcastToCompany(companyId, {
    type: typeMap[payload.status],
    connectionId,
    payload: {
      count: payload.count,
      conversations: payload.conversations,
    },
    timestamp: new Date().toISOString(),
  })
}
```

### 4. WebSocket Provider (`apps/web/src/contexts/WebSocketProvider.tsx`)

```typescript
// Sync state type
interface SyncState {
  connectionId: string
  conversations: number  // Running total of synced conversations
  startedAt: Date
}

// Add sync status handlers
const unsubSyncStart = client.on<{ connectionId: string }>('sync:start', (payload) => {
  setSyncState(prev => [...prev, {
    connectionId: payload.connectionId,
    conversations: 0,
    startedAt: new Date()
  }])
})

const unsubSyncProgress = client.on<{ connectionId: string, conversations: number }>('sync:progress', (payload) => {
  setSyncState(prev => prev.map(s =>
    s.connectionId === payload.connectionId
      ? { ...s, conversations: s.conversations + payload.conversations }
      : s
  ))
})

const unsubSyncComplete = client.on<{ connectionId: string }>('sync:complete', (payload) => {
  setSyncState(prev => prev.filter(s => s.connectionId !== payload.connectionId))
  // Invalidate chat list to show new contacts
  queryClientRef.current.invalidateQueries({ queryKey: chatKeys.lists() })
})
```

### 5. Syncing Overlay Component (`apps/web/src/components/chat/SyncingOverlay.tsx`)

```tsx
const SYNC_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

export function SyncingOverlay() {
  const { syncState } = useWebSocketContext()
  const [timedOut, setTimedOut] = useState(false)

  // Calculate total conversations across all syncing connections
  const totalConversations = syncState.reduce((sum, s) => sum + s.conversations, 0)

  // Check for timeout
  useEffect(() => {
    if (syncState.length === 0) return

    const oldestSync = syncState.reduce((oldest, s) =>
      s.startedAt < oldest.startedAt ? s : oldest
    )

    const elapsed = Date.now() - oldestSync.startedAt.getTime()
    if (elapsed >= SYNC_TIMEOUT_MS) {
      setTimedOut(true)
    }

    const timer = setTimeout(() => setTimedOut(true), SYNC_TIMEOUT_MS - elapsed)
    return () => clearTimeout(timer)
  }, [syncState])

  if (syncState.length === 0) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-primary">
      <div className="text-center">
        <Spinner className="mb-4 h-12 w-12" />
        <h2 className="text-xl text-dark-text-primary mb-2">Syncing messages...</h2>
        <p className="text-dark-text-secondary">
          {totalConversations > 0
            ? `${totalConversations} conversations synced`
            : 'Please wait while we sync your conversations'}
        </p>
        {timedOut && (
          <button
            onClick={() => setSyncState([])}
            className="mt-4 px-4 py-2 bg-whatsapp-green text-white rounded"
          >
            Continue anyway
          </button>
        )}
      </div>
    </div>
  )
}
```

## Affected Areas

### Backend (Go)
- `services/whatsapp/internal/handler/handler.go` - Add sync event handlers
- `services/whatsapp/internal/nats/publisher.go` - Add sync status publishing
- `services/whatsapp/internal/nats/subjects.go` - Add sync status subject

### Backend (API)
- `apps/api/src/services/message-handler.ts` - Handle sync status NATS events
- `apps/api/src/routes/ws.ts` - Add `sync:start`, `sync:complete` to `ServerMessage.type`
- `apps/api/src/lib/nats.ts` - Subscribe to sync status subject

### Frontend
- `apps/web/src/contexts/WebSocketProvider.tsx` - Add sync status handlers
- `apps/web/src/lib/websocket.ts` - Add sync event types
- `apps/web/src/components/chat/SyncingOverlay.tsx` - New component
- `apps/web/src/pages/ChatPage.tsx` - Integrate syncing overlay
- `apps/web/src/stores/websocket-store.ts` - Add syncing state (optional)

### Database (Optional)
- `packages/database/src/migrations/` - Add sync_status column migration

## Acceptance Criteria

- [ ] When user scans QR and WhatsApp connects, a "syncing" overlay appears on the chat page
- [ ] User cannot interact with chat list or navigate away during sync
- [ ] When sync completes, overlay dismisses and chat list shows all synced contacts
- [ ] Multiple connections: each connection's sync status is tracked independently
- [ ] Page reload during sync: overlay reappears based on persisted sync status
- [ ] Unit tests cover sync status tracking logic in Go service
- [ ] Unit tests cover WebSocket event handling in frontend

## Decisions

1. **Progress Tracking**: Yes, track HistorySync batches for progress indication (e.g., "Syncing... 50 conversations")
2. **Timeout**: 5 minutes - if sync doesn't complete, show warning and allow user to proceed
3. **Multi-connection Blocking**: Block all - if ANY connection is syncing, block access to chat until all complete

## Open Questions

1. Should the overlay show the connection name/phone number that's syncing?

---
*Generated from requirement interview on 2026-01-07*
