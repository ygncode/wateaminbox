# WhatsApp Connection Flow

This document describes the complete flow of adding a WhatsApp connection, from when a user clicks "Add Connection" to when the WhatsApp account is successfully connected and ready for messaging.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (React)                            │
│  1. User clicks "Add Connection"                                    │
│  2. POST /api/whatsapp/connections                                 │
│  3. WebSocket connects to /ws?company={id}&connection={id}         │
│  4. Receives QR code via WebSocket                                 │
│  5. Displays QR code to user                                        │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                   HTTP /ws (WebSocket)
                             │
┌────────────────────────────▼────────────────────────────────────────┐
│                    BACKEND API (Hono, Bun)                         │
│  /api/whatsapp/connections POST                                    │
│  - Create pending connection in DB                                 │
│  - Publish SPAWN command to NATS                                   │
│  - Return websocketUrl                                             │
│                                                                     │
│  /ws (WebSocket Endpoint)                                          │
│  - Authenticate user                                               │
│  - Track connection per company                                    │
│  - Broadcast QR/connected/disconnected events                     │
└────────────────────────────┬────────────────────────────────────────┘
                             │
              NATS JetStream (WHATSAPP.commands)
                             │
┌────────────────────────────▼────────────────────────────────────────┐
│              GO ORCHESTRATOR SERVICE                                │
│  - Listen for SPAWN commands                                       │
│  - SpawnWorker(companyId, connectionId, tenantSchema, dbUrl)      │
│  - Execute: whatsapp-worker binary                                 │
│  - Set environment variables with company/connection IDs          │
└────────────────────────────┬────────────────────────────────────────┘
                             │
              Process Execution (new worker binary)
                             │
┌────────────────────────────▼────────────────────────────────────────┐
│         GO WHATSAPP WORKER (one per connection)                    │
│  - Connect to PostgreSQL (tenant schema)                           │
│  - Initialize whatsmeow client                                    │
│  - Call waClient.Connect()                                        │
│  - whatsmeow generates QR code                                    │
│  - SetQRCallback publishes to NATS                                │
└────────────────────────────┬────────────────────────────────────────┘
                             │
         NATS JetStream (WHATSAPP.events)
                             │
┌────────────────────────────▼────────────────────────────────────────┐
│              BACKEND MESSAGE HANDLER                                │
│  - subscribeToAllEvents("WHATSAPP.events.>")                       │
│  - handleQREvent() → broadcastToCompany()                          │
│  - handleConnectedEvent() → broadcastToCompany()                   │
│  - Update database connection status                               │
└────────────────────────────┬────────────────────────────────────────┘
                             │
              WebSocket Broadcast to all clients
                             │
┌────────────────────────────▼────────────────────────────────────────┘
│                         FRONTEND (React)                            │
│  - Receives QR code message                                        │
│  - Displays QR for user to scan                                    │
│  - Receives connected message                                      │
│  - Updates UI to show connection active                            │
└─────────────────────────────────────────────────────────────────────┘
```

## Step-by-Step Flow

### Step 1: Frontend - User Initiates Connection

**File:** `apps/web/src/lib/api/whatsapp.ts`

When a user clicks "Add Connection", the frontend calls:

```typescript
export async function createWhatsAppConnection(
  name?: string
): Promise<WhatsAppConnection> {
  return fetchWithAuth<WhatsAppConnection>("/whatsapp/connections", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}
```

**Validation Schema:** `apps/web/src/lib/schemas/whatsapp-connection.ts`

- Validates optional connection name (max 100 characters)

---

### Step 2: Backend API - Create Connection & Spawn Worker

**File:** `apps/api/src/routes/whatsapp/connections.ts` (Lines 78-125)

**Endpoint:** `POST /api/whatsapp/connections`

The handler performs these operations:

1. **Validate connection limits** - Check if company has reached max connections (default: 5)
2. **Create pending connection** - Insert new record with `status: "pending"`
3. **Publish SPAWN command** - Send command to NATS for orchestrator

```typescript
export async function spawnConnection(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
  userId: string,
  name?: string
): Promise<{ connectionId: string; wsUrl: string }> {
  // Check connection limits
  const currentCount = await countActiveConnections(tenantDb);
  if (currentCount >= maxConnections) {
    throw new MaxConnectionsExceededError(currentCount, maxConnections);
  }

  // Create pending connection
  const connectionId = crypto.randomUUID();
  await tenantDb
    .insertInto("whatsapp_connections")
    .values({
      id: connectionId,
      name: name || null,
      status: "pending",
      connected_by: userId,
      created_at: toDbDate(),
      updated_at: toDbDate(),
    })
    .execute();

  // Publish SPAWN command to NATS
  await publishSpawnCommand(companyId, connectionId, env.DATABASE_URL);

  return {
    connectionId,
    wsUrl: `/ws?company=${companyId}&connection=${connectionId}`,
  };
}
```

**Response:** 201 Created

```json
{
  "success": true,
  "data": {
    "id": "connection-uuid",
    "status": "pending",
    "createdAt": "2024-01-15T14:30:00Z"
  },
  "websocketUrl": "/ws?company=company-uuid&connection=connection-uuid"
}
```

---

### Step 3: Database - Connection Record

**File:** `packages/database/src/migrations/015_fix_tenant_schema_baseline.ts`

**Table:** `whatsapp_connections` (per-tenant schema)

```sql
CREATE TABLE {tenant_schema}.whatsapp_connections (
  id UUID PRIMARY KEY,
  name VARCHAR(100),
  phone_number VARCHAR(50),
  jid VARCHAR(100),
  status VARCHAR(20),          -- 'pending', 'connected', 'disconnected', 'banned'
  connected_by UUID,
  connected_at TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  sync_status VARCHAR(20),
  connection_order INTEGER,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
```

---

### Step 4: NATS - Publish SPAWN Command

**File:** `apps/api/src/lib/nats/client.ts` (Lines 150-166)

**Function:** `publishSpawnCommand(companyId, connectionId, databaseUrl)`

Publishes to the JetStream `WHATSAPP_COMMANDS` stream:

```typescript
export async function publishSpawnCommand(
  companyId: string,
  connectionId: string,
  databaseUrl: string
): Promise<void> {
  const publisher = forConnection(
    companyId,
    connectionId,
    publishCommand,
    buildCommandSubject
  );
  await publisher.spawn(databaseUrl);
}
```

**Subject:** `WHATSAPP.commands.{companyId}.{connectionId}`

**Command Payload:**

```json
{
  "type": "spawn",
  "companyId": "company-uuid",
  "connectionId": "connection-uuid",
  "tenantSchema": "tenant_company-uuid",
  "databaseUrl": "postgres://..."
}
```

---

### Step 5: Go Orchestrator - Receive Command & Spawn Worker

**File:** `services/orchestrator/internal/manager/handlers.go` (Lines 136-156)

The orchestrator subscribes to `WHATSAPP.commands.>` and handles SPAWN commands:

```go
func (h *Handlers) handleSpawnCommand(ctx context.Context, data []byte) error {
  var cmd types.SpawnWorkerCommand
  json.Unmarshal(data, &cmd)

  // Spawn the worker process with environment variables
  err := h.manager.SpawnWorker(
    ctx,
    cmd.CompanyID,
    cmd.ConnectionID,
    cmd.TenantSchema,
    cmd.DatabaseURL,
  )

  if err != nil {
    h.publishStatusResponse(cmd.CompanyID, cmd.ConnectionID, types.StatusError, err.Error())
    return err
  }
  return nil
}
```

**Worker Environment Variables:**

- `COMPANY_ID` - Multi-tenant company ID
- `CONNECTION_ID` - Specific connection UUID
- `TENANT_SCHEMA` - PostgreSQL tenant schema (e.g., `tenant_company-uuid`)
- `DATABASE_URL` - PostgreSQL connection string
- `NATS_URL` - NATS broker URL
- `WORKER_ID` - Unique worker identifier

---

### Step 6: Go WhatsApp Worker - Initialize & Generate QR

**File:** `services/whatsapp/main.go`

The spawned worker process initializes the WhatsApp connection:

```go
func main() {
  // 1. Initialize NATS publisher for events
  publisher, err := natsClient.NewPublisher(PublisherConfig{
    NATSURL:      natsURL,
    CompanyID:    companyId,
    ConnectionID: connectionId,
  })

  // 2. Initialize WhatsApp client with whatsmeow
  waClient, err := client.New(ctx, client.Config{
    WorkerID:     workerID,
    CompanyID:    companyId,
    ConnectionID: connectionId,
    DatabaseURL:  databaseURL,
  })

  // 3. Register QR code callback
  waClient.SetQRCallback(func(qrCode string) {
    if err := publisher.PublishQRCode(qrCode); err != nil {
      log.Printf("Failed to publish QR code: %v", err)
    }
  })

  // 4. Register status callback
  waClient.SetStatusCallback(func(status, reason string) {
    if err := publisher.PublishConnectionStatus(status, reason, "", ""); err != nil {
      log.Printf("Failed to publish status: %v", err)
    }
  })

  // 5. Connect to WhatsApp (initiates QR code generation)
  if err := waClient.Connect(ctx); err != nil {
    log.Fatalf("Failed to connect to WhatsApp: %v", err)
  }
}
```

**QR Code Generation Flow:**

```
whatsmeow QR event
  → SetQRCallback()
  → PublishQRCode(qrCode)
  → NATS Publisher publishes event
```

---

### Step 7: NATS - Publish QR Code Event

**File:** `services/whatsapp/internal/nats/publisher.go`

**Function:** `PublishQRCode(qrCode string)`

**Subject:** `WHATSAPP.events.{companyId}.{connectionId}.qr`

**Event:**

```json
{
  "type": "qr",
  "companyId": "company-uuid",
  "connectionId": "connection-uuid",
  "payload": {
    "qrCode": "base64-encoded-qr-image",
    "expiresAt": "2024-01-15T14:35:00Z"
  },
  "timestamp": "2024-01-15T14:30:00Z"
}
```

---

### Step 8: Backend - Subscribe to Events & Broadcast

**File:** `apps/api/src/services/message-handler.ts`

The API server subscribes to ALL WhatsApp events:

```typescript
export async function initializeMessageHandler(): Promise<void> {
  // Subscribe to WHATSAPP.events.> (all events)
  eventSubscription = await subscribeToAllEvents(handleWhatsAppEvent);
  isInitialized = true;
}
```

**Subject Pattern:** `WHATSAPP.events.>` (wildcard matches all events)

---

### Step 9: Backend - Handle QR Event

**File:** `apps/api/src/services/handlers/connection-handlers.ts` (Lines 16-30)

```typescript
export async function handleQREvent(event: QREvent): Promise<void> {
  const { companyId, connectionId } = event;

  logger.info({ companyId, connectionId }, "QR code generated");

  // Broadcast to connected WebSocket clients
  broadcastToCompany(companyId, {
    type: "qr",
    connectionId,
    payload: event.payload,
    timestamp: event.timestamp,
  });
}
```

---

### Step 10: WebSocket - Broadcast to Frontend

**File:** `apps/api/src/routes/ws/connection.ts`

```typescript
const connections = new Map<string, Set<WebSocketConnection>>();

export function broadcastToCompany(
  companyId: string,
  message: ServerMessage
): void {
  const companyConnections = connections.get(companyId);
  if (companyConnections) {
    const payload = JSON.stringify(message);
    for (const ws of companyConnections) {
      if (ws.readyState === 1) {
        // OPEN
        ws.send(payload);
      }
    }
  }
}
```

---

### Step 11: Frontend - Display QR Code

The frontend receives the QR code via WebSocket and displays it to the user. The user scans the QR code with their WhatsApp mobile app.

---

### Step 12: User Scans QR - Authentication

When the user scans the QR code with their phone:

1. Phone sends authentication data to WhatsApp servers
2. WhatsApp servers relay to whatsmeow client
3. whatsmeow triggers `events.PairSuccess` event

**File:** `services/whatsapp/internal/handler/connection.go` (Lines 147-161)

```go
func (h *Handler) handlePairSuccess(evt *events.PairSuccess) {
  log.Printf("Worker %s paired successfully with %s", h.config.WorkerID, evt.ID.String());

  jid := evt.ID.String();
  phoneNumber := evt.ID.User;

  // Publish to NATS
  if h.publisher != nil {
    if err := h.publisher.PublishConnectionStatus("paired", "", phoneNumber, jid); err != nil {
      log.Printf("Failed to publish pair success status: %v", err)
    }
  }
}
```

---

### Step 13: Connection Established - Status Update

**NATS Event Subject:** `WHATSAPP.events.{companyId}.{connectionId}.connected`

```json
{
  "type": "connected",
  "companyId": "company-uuid",
  "connectionId": "connection-uuid",
  "payload": {
    "phoneNumber": "1234567890",
    "jid": "1234567890@s.whatsapp.net"
  },
  "timestamp": "2024-01-15T14:35:00Z"
}
```

**Backend Handler:** `apps/api/src/services/handlers/connection-handlers.ts` (Lines 35-65)

```typescript
export async function handleConnectedEvent(
  event: ConnectionEvent
): Promise<void> {
  const { companyId, connectionId, payload } = event;

  // Update connection status in database
  await updateConnectionStatus(
    tenantDb,
    "connected",
    connectionId,
    payload.phoneNumber,
    payload.jid
  );

  // Broadcast to WebSocket clients
  broadcastToCompany(companyId, {
    type: "connected",
    connectionId,
    payload: {
      phoneNumber: payload.phoneNumber,
      jid: payload.jid,
    },
    timestamp: event.timestamp,
  });
}
```

---

### Step 14: Database Update - Connected Status

**File:** `apps/api/src/services/whatsapp/connection.ts`

```sql
UPDATE {tenant_schema}.whatsapp_connections
SET
  status = 'connected',
  phone_number = '1234567890',
  jid = '1234567890@s.whatsapp.net',
  connected_at = NOW(),
  updated_at = NOW()
WHERE id = 'connection-uuid'
```

The connection is now fully operational for sending and receiving messages.

---

## Key Files Reference

| Layer                     | File Path                                                            | Purpose                        |
| ------------------------- | -------------------------------------------------------------------- | ------------------------------ |
| **Frontend API**          | `apps/web/src/lib/api/whatsapp.ts`                                   | `createWhatsAppConnection()`   |
| **Frontend Schema**       | `apps/web/src/lib/schemas/whatsapp-connection.ts`                    | Validation                     |
| **Backend Routes**        | `apps/api/src/routes/whatsapp/connections.ts`                        | POST endpoint                  |
| **Connection Service**    | `apps/api/src/services/whatsapp/connection.ts`                       | `spawnConnection()`            |
| **NATS Client**           | `apps/api/src/lib/nats/client.ts`                                    | `publishSpawnCommand()`        |
| **WebSocket Routes**      | `apps/api/src/routes/ws/index.ts`                                    | WebSocket upgrade              |
| **WebSocket Auth**        | `apps/api/src/routes/ws/auth.ts`                                     | `authenticateConnection()`     |
| **WebSocket Connection**  | `apps/api/src/routes/ws/connection.ts`                               | `broadcastToCompany()`         |
| **Message Handler**       | `apps/api/src/services/message-handler.ts`                           | `handleWhatsAppEvent()`        |
| **Event Handlers**        | `apps/api/src/services/handlers/connection-handlers.ts`              | QR, connected, disconnected    |
| **Database Schema**       | `packages/database/src/migrations/015_fix_tenant_schema_baseline.ts` | `whatsapp_connections` table   |
| **Orchestrator Main**     | `services/orchestrator/main.go`                                      | Entry point                    |
| **Orchestrator Handlers** | `services/orchestrator/internal/manager/handlers.go`                 | `handleSpawnCommand()`         |
| **WhatsApp Worker Main**  | `services/whatsapp/main.go`                                          | Entry point, QR callback setup |
| **WhatsApp Handler**      | `services/whatsapp/internal/handler/connection.go`                   | Connection events              |
| **NATS Events Shared**    | `services/shared/nats/events.go`                                     | Go event types                 |
| **Frontend WebSocket**    | `apps/web/src/contexts/websocket/connection-manager.ts`              | Client initialization          |

---

## Connection Status Lifecycle

```
pending → (QR generated) → (user scans) → connected
                                             ↓
                                        disconnected ← (logout/ban/error)
```

**Status Values:**

- `pending` - Connection created, waiting for QR scan
- `connected` - WhatsApp account linked and active
- `disconnected` - Connection was active but is now offline
- `banned` - WhatsApp account was banned

---

## Timing Notes

1. **Pending Status (0-2 minutes):** Connection exists in DB with `status='pending'`, waiting for whatsmeow to connect
2. **QR Code Generation:** Happens within `whatsmeow.Connect()`, published to NATS immediately
3. **QR Code Expiry:** QR codes expire after ~60 seconds, new one is generated automatically
4. **User Scans QR:** Phone authenticates with WhatsApp servers
5. **Connection Established:** whatsmeow fires `events.Connected` → `publishConnectionStatus()` → NATS event → database update
6. **Frontend Update:** WebSocket broadcast updates UI in real-time

---

## Error Handling

| Scenario                      | Handling                                                         |
| ----------------------------- | ---------------------------------------------------------------- |
| **Max connections exceeded**  | Returns 400 error with `MaxConnectionsExceededError`             |
| **Stale pending connections** | Cleanup job marks connections pending >2 minutes as disconnected |
| **Worker spawn failure**      | Orchestrator publishes error event to NATS                       |
| **QR code timeout**           | New QR code generated automatically by whatsmeow                 |
| **WebSocket disconnection**   | Connection tracking removes failed clients automatically         |
| **WhatsApp ban**              | Status updated to `banned`, worker terminates                    |

---

## NATS Subjects Reference

**Commands (Backend → Orchestrator):**

- `WHATSAPP.commands.{companyId}.{connectionId}` - SPAWN, STOP commands

**Events (Worker → Backend):**

- `WHATSAPP.events.{companyId}.{connectionId}.qr` - QR code generated
- `WHATSAPP.events.{companyId}.{connectionId}.connected` - Connection established
- `WHATSAPP.events.{companyId}.{connectionId}.disconnected` - Connection lost
- `WHATSAPP.events.{companyId}.{connectionId}.message` - Incoming message
