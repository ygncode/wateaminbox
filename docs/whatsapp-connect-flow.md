# WhatsApp Connection Flow

This document provides a deep technical dive into how WhatsApp connections work in this platform, from user scanning a QR code to receiving messages.

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Connection Flow Step-by-Step](#connection-flow-step-by-step)
4. [Component Details](#component-details)
5. [Data Flow Diagrams](#data-flow-diagrams)
6. [Database Schema](#database-schema)
7. [NATS Messaging](#nats-messaging)
8. [Multi-Connection Support](#multi-connection-support)
9. [Message Sending Pipeline](#message-sending-pipeline)
10. [Session Persistence & Reconnection](#session-persistence--reconnection)

---

## Overview

The platform uses a microservices architecture to manage WhatsApp Web connections:

- **Frontend (React)** - User interface for QR code display and chat
- **API (Hono/Bun)** - REST API and WebSocket server
- **Orchestrator (Go)** - Manages WhatsApp worker processes
- **WhatsApp Worker (Go)** - Individual process per connection using whatsmeow
- **NATS JetStream** - Message broker for async communication
- **PostgreSQL** - Session storage and application data

Each WhatsApp connection runs as a separate Go process, communicating via NATS. This isolation ensures one connection failure doesn't affect others.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND                                    │
│  React + Vite + TanStack Query + WebSocket                              │
│  - WhatsAppConnectionPanel (QR display, status)                         │
│  - useWhatsAppConnections hook                                          │
└─────────────────────────────────┬───────────────────────────────────────┘
                                  │ REST API + WebSocket
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                              API SERVER                                  │
│  Hono + Bun (Port 3001)                                                 │
│  - /api/whatsapp/* routes                                               │
│  - WebSocket server for real-time updates                               │
│  - NATS publisher/subscriber                                            │
└──────────────┬──────────────────────────────────┬───────────────────────┘
               │                                  │
               ▼                                  ▼
┌──────────────────────────┐         ┌────────────────────────────────────┐
│      NATS JetStream      │         │           PostgreSQL               │
│  - WHATSAPP_COMMANDS     │         │  - Public schema (users, companies)│
│  - WHATSAPP_EVENTS       │         │  - Tenant schemas (contacts, msgs) │
│                          │         │  - whatsapp_sessions schema        │
└──────────────┬───────────┘         └────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           ORCHESTRATOR                                   │
│  Go service managing worker lifecycle                                    │
│  - Receives spawn/kill commands                                         │
│  - Spawns whatsapp-worker processes                                     │
│  - Health monitoring                                                    │
└──────────────┬──────────────────────────────────────────────────────────┘
               │ Spawns processes
               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      WHATSAPP WORKERS (1 per connection)                │
│  Go process using whatsmeow library                                     │
│  - Connects to WhatsApp Web servers                                     │
│  - Handles QR code generation                                           │
│  - Processes incoming/outgoing messages                                 │
│  - Stores session in PostgreSQL                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Connection Flow Step-by-Step

### Step 1: User Initiates Connection

**Frontend:** `apps/web/src/components/whatsapp/WhatsAppConnectionPanel.tsx`

1. User clicks "Add Connection" button
2. Frontend calls `POST /api/whatsapp/connections`
3. Receives `connectionId` and WebSocket URL
4. Opens WebSocket to receive real-time updates

```typescript
// Hook usage
const { create, connections } = useWhatsAppConnections();

// Create new connection
const { connectionId, wsUrl } = await create({ name: "My WhatsApp" });
```

### Step 2: API Creates Pending Connection

**API:** `apps/api/src/routes/whatsapp.ts`

1. Validates user authentication and company context
2. Checks company hasn't exceeded `max_whatsapp_connections` limit
3. Creates record in `whatsapp_connections` table with status `pending`
4. Publishes SPAWN command to NATS
5. Returns connection ID to frontend

```typescript
// POST /api/whatsapp/connections
{
  connectionId: "97703217-8d5c-4081-9023-0a4e20d8204a",
  wsUrl: "/api/ws?company=xxx&connection=xxx"
}
```

### Step 3: Orchestrator Spawns Worker

**Orchestrator:** `services/orchestrator/internal/manager/manager.go`

1. Receives SPAWN command from NATS
2. Validates command and checks for duplicate workers
3. Spawns new `whatsapp-worker` process with environment:
   - `COMPANY_ID` - UUID of the company
   - `CONNECTION_ID` - UUID of this connection
   - `TENANT_SCHEMA` - PostgreSQL schema (e.g., `tenant_xxx`)
   - `DATABASE_URL` - PostgreSQL connection string
   - `NATS_URL` - NATS server URL
4. Tracks PID and monitors health

```go
cmd := exec.Command(binaryPath)
cmd.Env = append(os.Environ(),
    "COMPANY_ID="+companyID,
    "CONNECTION_ID="+connectionID,
    "TENANT_SCHEMA="+tenantSchema,
    "DATABASE_URL="+databaseURL,
    "NATS_URL="+natsURL,
)
cmd.Start()
```

### Step 4: Worker Generates QR Code

**Worker:** `services/whatsapp/internal/client/client.go`

1. Worker initializes and checks for existing session in PostgreSQL
2. No session found → starts QR code flow
3. Calls whatsmeow's `GetQRChannel()` to get QR events
4. Receives QR code string
5. Publishes QR to NATS → API → WebSocket → Frontend

```go
func (c *Client) connectWithQR(ctx context.Context) error {
    qrChan, _ := c.client.GetQRChannel(ctx)

    for evt := range qrChan {
        switch evt.Event {
        case "code":
            // QR code available - publish to NATS
            c.qrCallback(evt.Code)
        case "success":
            // Pairing successful
            c.statusCallback("connected", "paired")
        case "timeout":
            // QR expired
            c.statusCallback("disconnected", "qr_timeout")
        }
    }
}
```

### Step 5: User Scans QR Code

1. Frontend displays QR using external service:
   ```
   https://api.qrserver.com/v1/create-qr-code/?size=256x256&data={qrCode}
   ```
2. User opens WhatsApp on phone
3. Goes to: **Settings → Linked Devices → Link a Device**
4. Scans QR code with phone camera
5. WhatsApp servers validate and establish connection

### Step 6: Connection Established

**Worker receives pairing success:**

1. whatsmeow fires `PairSuccess` event
2. Device credentials stored in PostgreSQL (`whatsapp_sessions.whatsmeow_device`)
3. Worker publishes `connected` event to NATS with phone number and JID
4. API updates `whatsapp_connections` table:
   - `status` → `connected`
   - `phone_number` → extracted from JID
   - `jid` → full WhatsApp JID (e.g., `1234567890@s.whatsapp.net`)
   - `connected_at` → current timestamp
5. Frontend receives WebSocket event, shows connected status

### Step 7: Ongoing Message Handling

Once connected, the worker:

1. **Receives messages** via whatsmeow event handler
2. **Publishes to NATS** for API to store and forward
3. **Listens for send commands** via NATS subscriber
4. **Sends messages** through whatsmeow to WhatsApp

---

## Component Details

### Frontend Components

| Component              | File                              | Purpose                          |
| ---------------------- | --------------------------------- | -------------------------------- |
| MultiConnectionPanel   | `WhatsAppConnectionPanel.tsx`     | Manages multiple connections     |
| SingleConnectionPanel  | `WhatsAppConnectionPanel.tsx`     | Legacy single connection mode    |
| useWhatsAppConnections | `hooks/useWhatsAppConnections.ts` | React Query hook for connections |

### API Routes

| Endpoint                               | Method | Purpose                |
| -------------------------------------- | ------ | ---------------------- |
| `/whatsapp/connections`                | POST   | Create new connection  |
| `/whatsapp/connections`                | GET    | List all connections   |
| `/whatsapp/connections/:id`            | GET    | Get connection details |
| `/whatsapp/connections/:id/disconnect` | POST   | Disconnect             |
| `/whatsapp/connections/:id/send`       | POST   | Send message           |

### Worker Files

| File                          | Purpose                     |
| ----------------------------- | --------------------------- |
| `main.go`                     | Entry point, initialization |
| `internal/client/client.go`   | WhatsApp client wrapper     |
| `internal/handler/handler.go` | Event processing            |
| `internal/nats/publisher.go`  | Publish events to NATS      |
| `internal/nats/subscriber.go` | Listen for send commands    |
| `internal/store/pgstore.go`   | PostgreSQL session storage  |

---

## Data Flow Diagrams

### QR Code Flow

```
User clicks "Add Connection"
         │
         ▼
┌─────────────────────┐
│ POST /connections   │
│ Create pending      │
│ Publish SPAWN       │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐     ┌─────────────────────┐
│ NATS: SPAWN command │────▶│ Orchestrator        │
└─────────────────────┘     │ Spawn worker process│
                            └─────────┬───────────┘
                                      │
                                      ▼
                            ┌─────────────────────┐
                            │ WhatsApp Worker     │
                            │ Connect to WhatsApp │
                            │ Get QR code         │
                            └─────────┬───────────┘
                                      │
                                      ▼
┌─────────────────────┐     ┌─────────────────────┐
│ NATS: QR event      │◀────│ Publish QR code     │
└─────────┬───────────┘     └─────────────────────┘
          │
          ▼
┌─────────────────────┐     ┌─────────────────────┐
│ API receives event  │────▶│ WebSocket to client │
└─────────────────────┘     └─────────┬───────────┘
                                      │
                                      ▼
                            ┌─────────────────────┐
                            │ Frontend shows QR   │
                            │ User scans with     │
                            │ WhatsApp phone app  │
                            └─────────────────────┘
```

### Message Flow (Incoming)

```
WhatsApp sends message
         │
         ▼
┌─────────────────────┐
│ whatsmeow receives  │
│ Message event       │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Handler processes   │
│ - Extract content   │
│ - Download media    │
│ - Format payload    │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ NATS: message event │
│ WHATSAPP.events.    │
│ {company}.{conn}.   │
│ message             │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ API Message Handler │
│ - Store in database │
│ - Update contact    │
│ - Forward via WS    │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ WebSocket broadcast │
│ to connected users  │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Frontend updates    │
│ chat in real-time   │
└─────────────────────┘
```

---

## Database Schema

### Tenant Schema (`tenant_{company_id}`)

```sql
-- WhatsApp connections per company
CREATE TABLE whatsapp_connections (
    id UUID PRIMARY KEY,
    name VARCHAR(255),
    phone_number VARCHAR(50),
    jid VARCHAR(255),
    status VARCHAR(20), -- pending, connected, disconnected, banned
    connected_by UUID REFERENCES users(id),
    connected_at TIMESTAMPTZ,
    last_sync_at TIMESTAMPTZ,
    connection_order INTEGER,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
);

-- Contacts synced from WhatsApp
CREATE TABLE contacts (
    id UUID PRIMARY KEY,
    whatsapp_connection_id UUID REFERENCES whatsapp_connections(id),
    jid VARCHAR(255),
    phone_number VARCHAR(50),
    push_name VARCHAR(255), -- WhatsApp display name
    custom_name VARCHAR(255),
    is_group BOOLEAN,
    profile_picture_url TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
);

-- Message history
CREATE TABLE messages (
    id UUID PRIMARY KEY,
    whatsapp_connection_id UUID REFERENCES whatsapp_connections(id),
    contact_id UUID REFERENCES contacts(id),
    message_id VARCHAR(255), -- WhatsApp's message ID
    from_me BOOLEAN,
    sender_jid VARCHAR(255),
    message_type VARCHAR(50), -- text, image, video, audio, document
    content TEXT,
    media_url TEXT,
    quoted_message_id VARCHAR(255),
    timestamp TIMESTAMPTZ,
    created_at TIMESTAMPTZ
);
```

### Session Schema (`whatsapp_sessions`)

```sql
-- Device credentials (Signal protocol)
CREATE TABLE whatsmeow_device (
    connection_id UUID,
    jid TEXT,
    registration_id INTEGER,
    noise_key BYTEA,
    identity_key BYTEA,
    signed_pre_key BYTEA,
    signed_pre_key_id INTEGER,
    signed_pre_key_sig BYTEA,
    adv_key BYTEA,
    platform TEXT,
    business_name TEXT,
    push_name TEXT,
    PRIMARY KEY (connection_id, jid)
);

-- Signal protocol session state
CREATE TABLE whatsmeow_sessions (
    connection_id UUID,
    our_jid TEXT,
    their_id TEXT,
    session BYTEA,
    PRIMARY KEY (connection_id, our_jid, their_id)
);

-- Identity keys for E2E encryption
CREATE TABLE whatsmeow_identity_keys (
    connection_id UUID,
    our_jid TEXT,
    their_id TEXT,
    identity BYTEA,
    PRIMARY KEY (connection_id, our_jid, their_id)
);

-- Pre-shared keys
CREATE TABLE whatsmeow_pre_keys (
    connection_id UUID,
    jid TEXT,
    key_id INTEGER,
    key BYTEA,
    uploaded BOOLEAN,
    PRIMARY KEY (connection_id, jid, key_id)
);

-- LID to phone number mappings
CREATE TABLE whatsmeow_lid_mappings (
    connection_id UUID,
    lid TEXT,
    jid TEXT,
    PRIMARY KEY (connection_id, lid)
);
```

---

## NATS Messaging

### Streams

| Stream            | Purpose                    | Retention |
| ----------------- | -------------------------- | --------- |
| WHATSAPP_COMMANDS | API → Orchestrator/Workers | 24 hours  |
| WHATSAPP_EVENTS   | Workers → API              | 7 days    |

### Subject Patterns

```
Commands (sent by API):
  WHATSAPP.commands                           # Orchestrator commands (spawn/kill)
  WHATSAPP.commands.{companyId}.{connectionId} # Worker-specific commands

Events (sent by workers):
  WHATSAPP.events.{companyId}.{connectionId}.qr          # QR code
  WHATSAPP.events.{companyId}.{connectionId}.connected   # Connection established
  WHATSAPP.events.{companyId}.{connectionId}.disconnected
  WHATSAPP.events.{companyId}.{connectionId}.message     # Incoming message
  WHATSAPP.events.{companyId}.{connectionId}.receipt     # Delivery/read receipt
```

### Command Payloads

```json
// Spawn worker
{
  "type": "spawn",
  "company_id": "uuid",
  "connection_id": "uuid",
  "tenant_schema": "tenant_uuid",
  "database_url": "postgres://..."
}

// Send message
{
  "message_id": "uuid",
  "to": "1234567890@s.whatsapp.net",
  "type": "text",
  "content": "Hello!",
  "reply_to": "optional-quoted-message-id",
  "reply_to_sender": "optional-sender-jid"
}
```

### Event Payloads

```json
// QR code event
{
  "type": "qr",
  "companyId": "uuid",
  "connectionId": "uuid",
  "payload": {
    "qrCode": "2@abc123..."
  }
}

// Message event
{
  "type": "message",
  "companyId": "uuid",
  "connectionId": "uuid",
  "timestamp": "2024-01-04T12:00:00Z",
  "payload": {
    "messageId": "3EB0...",
    "from": "1234567890@s.whatsapp.net",
    "fromMe": false,
    "content": "Hello",
    "messageType": "text",
    "isGroup": false,
    "senderName": "John"
  }
}
```

---

## Multi-Connection Support

### Company Limits

Each company has a `max_whatsapp_connections` limit (default: 5). This is enforced when creating new connections.

### Connection Isolation

- Each connection has unique UUID
- Separate worker process per connection
- Independent session storage in PostgreSQL
- Scoped NATS subjects per connection

### Frontend Display

```
┌─────────────────────────────────────────┐
│ WhatsApp Connections                    │
├─────────────────────────────────────────┤
│ ┌─────────────────────────────────────┐ │
│ │ 📱 Sales WhatsApp                   │ │
│ │ +1 234 567 8901                     │ │
│ │ ● Connected                         │ │
│ └─────────────────────────────────────┘ │
│ ┌─────────────────────────────────────┐ │
│ │ 📱 Support WhatsApp                 │ │
│ │ +1 234 567 8902                     │ │
│ │ ● Connected                         │ │
│ └─────────────────────────────────────┘ │
│ ┌─────────────────────────────────────┐ │
│ │ + Add Connection                    │ │
│ │ (3/5 connections used)              │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

---

## Message Sending Pipeline

### Text Message

```
1. Frontend: POST /api/whatsapp/connections/{id}/send
   {
     "jid": "1234567890@s.whatsapp.net",
     "content": "Hello!",
     "messageType": "text"
   }

2. API validates connection is "connected"

3. API publishes to NATS:
   Subject: WHATSAPP.commands.{companyId}.{connectionId}
   {
     "message_id": "uuid",
     "to": "1234567890@s.whatsapp.net",
     "type": "text",
     "content": "Hello!"
   }

4. Worker subscriber receives command

5. Worker calls whatsmeow:
   client.SendMessage(ctx, jid, &waProto.Message{
     Conversation: proto.String("Hello!")
   })

6. WhatsApp returns message ID and timestamp

7. Worker publishes receipt to NATS

8. API updates message status in database

9. Frontend receives WebSocket update
```

### Reply Message

When replying to a message:

```json
{
  "jid": "1234567890@s.whatsapp.net",
  "content": "This is a reply",
  "messageType": "text",
  "replyTo": "3EB0ABC123...",
  "replyToSender": "9876543210@s.whatsapp.net"
}
```

The worker constructs an `ExtendedTextMessage` with `ContextInfo` containing the quoted message reference.

---

## Session Persistence & Reconnection

### Session Storage

Device credentials are stored in PostgreSQL's `whatsapp_sessions` schema, isolated by `connection_id`. This includes:

- **Noise keys** - For establishing encrypted connection
- **Identity keys** - Signal protocol identity
- **Signed pre-keys** - For key exchange
- **Session state** - Per-contact encryption state

### Reconnection Flow

```
Worker starts
    │
    ▼
Check whatsmeow_device for connection_id
    │
    ├─── Session exists ───▶ reconnect()
    │                            │
    │                            ▼
    │                       Establish WebSocket
    │                       to WhatsApp servers
    │                            │
    │                            ▼
    │                       Status: connected
    │
    └─── No session ───────▶ connectWithQR()
                                 │
                                 ▼
                            Generate QR code
                            Wait for scan
```

### Auto-Reconnection

If disconnected unexpectedly:

1. Worker detects disconnect event
2. Attempts reconnection with exponential backoff
3. Initial delay: 5 seconds
4. Max delay: 50 seconds
5. Max attempts: 5
6. If all fail, publishes `disconnected` status

---

## Troubleshooting

### Common Issues

| Issue                    | Cause                   | Solution                                       |
| ------------------------ | ----------------------- | ---------------------------------------------- |
| QR not appearing         | Worker not spawned      | Check orchestrator logs                        |
| "Couldn't link device"   | Crypto key issue        | Clear session, reconnect                       |
| Stuck at "Logging in..." | Missing LIDStore        | Ensure pgstore.go has `device.LIDs = sqlStore` |
| Messages not sending     | NATS subscription issue | Check subscriber logs                          |

### Debug Logs

```bash
# Watch orchestrator logs
cd services/orchestrator && go run main.go 2>&1 | tee orchestrator.log

# Watch specific worker
tail -f /tmp/worker-{connection-id}.log

# Check NATS streams
nats stream info WHATSAPP_EVENTS
nats consumer info WHATSAPP_COMMANDS orchestrator-commands
```

---

## History Sync (After Pairing)

When a device is successfully paired, WhatsApp sends a `HistorySync` event containing recent conversations and messages.

### What Gets Synced

| Data            | Synced? | Notes                                    |
| --------------- | ------- | ---------------------------------------- |
| Contacts        | ✅ Yes  | JID, name, display name, is_group, unread count |
| Text messages   | ✅ Yes  | Full content                             |
| Image messages  | ✅ Yes  | Downloaded and uploaded to storage       |
| Video messages  | ✅ Yes  | Downloaded and uploaded to storage       |
| Audio messages  | ✅ Yes  | Downloaded and uploaded to storage       |
| Documents       | ✅ Yes  | Downloaded with filename preserved       |
| Stickers        | ✅ Yes  | Downloaded and uploaded to storage       |

### History Sync Flow

```
PairSuccess event received
         │
         ▼
┌─────────────────────────────────────────┐
│ WhatsApp sends HistorySync event        │
│ Contains: conversations[], messages[]   │
└─────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│ Worker: handleHistorySync()             │
│                                         │
│ For each conversation:                  │
│   1. Publish contact to NATS            │
│   2. For each message:                  │
│      - Extract content/metadata         │
│      - Download media (with rate limit) │
│      - Upload to storage                │
│      - Publish message to NATS          │
└─────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│ API: message-handler.ts                 │
│                                         │
│ handleContactEvent()                    │
│   → Creates/updates contacts table      │
│                                         │
│ handleMessageEvent()                    │
│   → Stores messages with media_url      │
│   → Broadcasts to WebSocket             │
└─────────────────────────────────────────┘
```

### Rate Limiting

Media downloads during history sync include a **100ms delay** between each download to avoid:
- Overwhelming the storage service (MinIO/R2)
- Hitting WhatsApp rate limits
- Network congestion during initial sync

### Sync Logs

```
History sync received: 15 conversations
Processing 42 messages for conversation 1234567890@s.whatsapp.net
Downloaded history media: 245632 bytes, type: image/jpeg
History media uploaded: https://storage.example.com/media/...
History sync complete: 42 messages, 8 media downloaded, 0 media failed
```

---

## Security Considerations

1. **E2E Encryption**: All WhatsApp messages use Signal protocol encryption
2. **Session Isolation**: Each connection has isolated session storage
3. **Multi-Tenancy**: Tenant schemas prevent cross-company data access
4. **JWT Auth**: All API requests require valid JWT tokens
5. **Company Scoping**: X-Company-ID header required for tenant context
