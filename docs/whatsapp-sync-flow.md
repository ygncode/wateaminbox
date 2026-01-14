# WhatsApp Sync Flow

This document describes how WhatsApp data (messages, contacts, groups, reactions) is synchronized from WhatsApp to the database, covering both initial history sync and real-time updates.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         WhatsApp Servers                                     │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                    WhatsApp Web Protocol
                               │
┌──────────────────────────────▼──────────────────────────────────────────────┐
│               GO WHATSAPP WORKER (whatsmeow)                                │
│  services/whatsapp/                                                         │
│  - One process per WhatsApp connection                                      │
│  - Handles all WhatsApp events                                              │
│  - Downloads/uploads media to R2/MinIO                                      │
│  - Publishes events to NATS                                                 │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
             NATS JetStream (WHATSAPP.events.*)
                               │
┌──────────────────────────────▼──────────────────────────────────────────────┐
│                    BACKEND API (Hono, Bun)                                  │
│  apps/api/src/services/handlers/                                            │
│  - Subscribes to all WHATSAPP.events                                        │
│  - Routes events to appropriate handlers                                    │
│  - Persists data to PostgreSQL                                              │
│  - Broadcasts to WebSocket clients                                          │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                   PostgreSQL (tenant schemas)
                               │
┌──────────────────────────────▼──────────────────────────────────────────────┐
│                         FRONTEND (React)                                    │
│  - Receives WebSocket broadcasts                                            │
│  - Updates UI in real-time                                                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## NATS Event Architecture

### Streams

| Stream | Purpose |
|--------|---------|
| `WHATSAPP.events.*` | WhatsApp events (messages, presence, reactions, etc.) |
| `WHATSAPP.commands.*` | Commands (spawn, kill, send message, etc.) |
| `WHATSAPP.download.*` | On-demand media download requests |

### Event Subject Pattern

```
WHATSAPP.events.{companyId}.{connectionId}.{eventType}
```

### Event Types

| Event Type | Description |
|------------|-------------|
| `qr` | QR code for pairing |
| `status` | Connection status (connected/disconnected) |
| `message` | Incoming/outgoing messages |
| `receipt` | Message delivery status (sent/delivered/read) |
| `presence` | Online/offline status |
| `contact` | Contact sync from history |
| `profile_picture` | Profile picture updates |
| `message_revoke` | Message deletion |
| `send_confirmation` | Real WhatsApp message ID mapping |
| `typing` | Typing indicators |
| `reaction` | Message reactions |
| `sync_status` | History sync progress (starting/progress/completed) |
| `download_response` | Media download completion |

---

## 1. History Sync (Initial Data Import)

When a WhatsApp connection is first established, whatsmeow fires a `HistorySync` event containing all existing conversations, messages, and contacts.

### 1.1 Trigger Point

**File:** `services/whatsapp/internal/handler/history_sync.go`

The sync begins when whatsmeow emits `events.HistorySync` after successful pairing.

### 1.2 Processing Pipeline

```
HistorySync Event (whatsmeow)
    │
    ├─ PublishSyncStatus("starting")
    │   → Notifies frontend that sync is beginning
    │
    ├─ Create 10 parallel worker goroutines
    │
    └─ For each conversation in history:
        │
        ├─ processHistorySyncConversation()
        │   │
        │   ├─ Fetch & upload profile picture
        │   │   └─ Download from WhatsApp → Upload to R2/MinIO
        │   │
        │   ├─ PublishContact() → NATS
        │   │   └─ Contact info: JID, push_name, is_group, profile_url
        │   │
        │   ├─ Subscribe to presence updates
        │   │   └─ h.config.Client.SubscribePresence(ctx, normalizedJID)
        │   │
        │   └─ For each message in conversation:
        │       │
        │       └─ processHistorySyncMessage()
        │           │
        │           ├─ Download media (images, videos, docs) with retry
        │           │   └─ Max 4 attempts, exponential backoff
        │           │
        │           ├─ Upload media to R2/MinIO
        │           │
        │           └─ PublishMessage() → NATS
        │               └─ Message with mediaUrl or deferred media metadata
        │
        └─ For each reaction on messages:
            │
            └─ processHistorySyncReaction()
                └─ PublishReaction() → NATS
    │
    └─ PublishSyncStatus("completed")
        → Notifies frontend that sync is done
```

### 1.3 Worker Pool

The history sync uses 10 parallel workers for concurrent processing:

```go
const maxWorkers = 10
results := make(chan conversationResult, len(data.Conversations))

for i := 0; i < maxWorkers; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for conv := range conversationChannel {
            // Process conversation
        }
    }()
}
```

Progress is published every 10 conversations to update the frontend.

### 1.4 Media Download with Retry

```go
const maxRetries = 3
const initialBackoff = 1 * time.Second

for attempt := 0; attempt <= maxRetries; attempt++ {
    ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
    data, err := h.config.Client.Download(msg)
    cancel()

    if err == nil {
        return data, nil
    }

    backoff := initialBackoff * time.Duration(1<<uint(attempt))  // 1s, 2s, 4s
    time.Sleep(backoff)
}
```

---

## 2. Contact Sync

### 2.1 Contact Sources

Contacts are created/updated from three sources:

1. **History Sync** - All contacts from past conversations
2. **New Message** - Auto-create on first message from unknown contact
3. **Presence Update** - Can create contact if not exists

### 2.2 Contact Event Processing

**File:** `apps/api/src/services/handlers/contact-handlers.ts`

```typescript
handleContactEvent(event: ContactEvent)
    │
    ├─ Normalize JID (remove device suffix)
    │
    ├─ Check if contact exists by JID
    │
    ├─ If exists → UPDATE:
    │   ├─ push_name (display name from WhatsApp)
    │   ├─ is_group
    │   ├─ profile_picture_url
    │   └─ updated_at
    │
    └─ If new → INSERT:
        ├─ id: UUID
        ├─ jid (normalized)
        ├─ phone_number (extracted from JID)
        ├─ push_name
        ├─ is_group
        ├─ profile_picture_url
        ├─ whatsapp_connection_id
        └─ created_at, updated_at
```

### 2.3 Contact Database Schema

**Table:** `contacts` (per-tenant schema)

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `jid` | VARCHAR | WhatsApp JID (normalized) |
| `phone_number` | VARCHAR | Phone number (from JID) |
| `push_name` | VARCHAR | Display name from WhatsApp |
| `custom_name` | VARCHAR | User-defined name |
| `is_group` | BOOLEAN | Is this a group chat |
| `is_online` | BOOLEAN | Current online status |
| `last_seen` | TIMESTAMPTZ | Last seen timestamp |
| `is_blocked` | BOOLEAN | Block status |
| `profile_picture_url` | VARCHAR | S3 URL of profile picture |
| `whatsapp_connection_id` | UUID | FK to whatsapp_connections |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update timestamp |

---

## 3. Real-Time Message Sync

### 3.1 Incoming Message Flow

**File:** `services/whatsapp/internal/handler/messages.go`

```
Message Event (whatsmeow)
    │
    └─ handleMessage()
        │
        ├─ Normalize sender JID
        │
        ├─ Subscribe to sender presence (for online status)
        │
        ├─ Extract message content based on type:
        │   ├─ Text → Conversation or ExtendedTextMessage
        │   ├─ Image → ImageMessage + download media
        │   ├─ Video → VideoMessage + download media
        │   ├─ Audio → AudioMessage + download media
        │   ├─ Document → DocumentMessage + download media
        │   ├─ Sticker → StickerMessage + download media
        │   ├─ Location → LocationMessage (lat, lng, name)
        │   └─ Contact → ContactMessage (vCard)
        │
        ├─ Download media with 135s timeout (if applicable)
        │
        └─ PublishMessage() → NATS
            └─ Payload includes:
                ├─ messageId (WhatsApp ID)
                ├─ from, to (JIDs)
                ├─ content (text or caption)
                ├─ messageType (text, image, video, etc.)
                ├─ mediaUrl, mediaSize, mediaType
                ├─ isHistorySync flag
                └─ Deferred media fields (if not downloaded)
```

### 3.2 Message Storage

**File:** `apps/api/src/services/handlers/message-handlers.ts`

```typescript
handleMessageEvent(event: MessageEvent)
    │
    ├─ Get active WhatsApp connection
    │
    ├─ Get or create contact
    │   └─ Uses JID to find/create contact record
    │
    ├─ Check for duplicate (unique: connection_id + message_id)
    │
    ├─ Insert message into database:
    │   │
    │   ├─ Core fields:
    │   │   ├─ id, message_id (WhatsApp ID)
    │   │   ├─ contact_id, whatsapp_connection_id
    │   │   ├─ content, message_type
    │   │   ├─ from_me, sender_jid
    │   │   └─ timestamp, status
    │   │
    │   ├─ Media fields (if present):
    │   │   ├─ media_url, media_type, media_size
    │   │   └─ media_download_status
    │   │
    │   └─ Deferred media fields (if media not downloaded):
    │       ├─ media_direct_path
    │       ├─ media_key (encryption key)
    │       ├─ media_file_sha256
    │       ├─ media_file_enc_sha256
    │       └─ media_download_status = "pending"
    │
    ├─ Index for search:
    │   ├─ Update PostgreSQL full-text search vector
    │   └─ Index in Meilisearch (background)
    │
    ├─ Update conversation state (skip for history sync):
    │   ├─ Increment unread_count
    │   ├─ Set last_message_at
    │   └─ Store last_message_preview
    │
    └─ Broadcast to WebSocket (skip for history sync):
        └─ message:new event with full message data
```

### 3.3 Message Database Schema

**Table:** `messages` (per-tenant schema)

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `message_id` | VARCHAR | WhatsApp message ID |
| `contact_id` | UUID | FK to contacts |
| `whatsapp_connection_id` | UUID | FK to whatsapp_connections |
| `content` | TEXT | Message text/caption |
| `message_type` | VARCHAR | text, image, video, audio, document, sticker, location, contact, reaction |
| `from_me` | BOOLEAN | Sent by us |
| `sender_jid` | VARCHAR | Sender JID (for groups) |
| `status` | VARCHAR | pending, sent, delivered, read, failed |
| `timestamp` | TIMESTAMPTZ | Message timestamp |
| `media_url` | VARCHAR | S3 URL of media |
| `media_type` | VARCHAR | MIME type |
| `media_size` | INTEGER | File size in bytes |
| `media_download_status` | VARCHAR | pending, completed, failed |
| `media_direct_path` | VARCHAR | WhatsApp CDN path (deferred) |
| `media_key` | VARCHAR | Encryption key (deferred) |
| `media_file_sha256` | VARCHAR | File hash (deferred) |
| `deleted_by_sender` | BOOLEAN | Message was deleted |
| `deleted_at` | TIMESTAMPTZ | When deleted |
| `created_at` | TIMESTAMPTZ | DB insertion time |

---

## 4. Group Sync

### 4.1 Group Detection

Groups are identified during history sync:

```go
isGroup := c.GetIsDefaultSubgroup() || len(c.GetParticipant()) > 0
```

JID formats:
- **Contacts:** `{phoneNumber}@s.whatsapp.net`
- **Groups:** `{groupId}@g.us`

### 4.2 Group Storage

Groups are stored in the `contacts` table with `is_group = true`:

| Field | Value |
|-------|-------|
| `jid` | `{groupId}@g.us` |
| `is_group` | `true` |
| `push_name` | Group name |
| `profile_picture_url` | Group picture |

### 4.3 Group Message Handling

For messages in groups, additional fields are stored:

| Field | Description |
|-------|-------------|
| `sender_jid` | Who sent the message in the group |
| `from_me` | Is it our own message |

---

## 5. Message Reactions

### 5.1 Reaction Sources

1. **History Sync** - Past reactions from `ReactionMessage`
2. **Real-time** - New reaction events

### 5.2 Reaction Processing

**File:** `services/whatsapp/internal/handler/history_sync.go`

```go
processHistorySyncReaction(reaction)
    │
    ├─ Get target message ID
    ├─ Extract sender JID
    ├─ Get emoji
    │
    └─ PublishReaction() → NATS
        └─ Payload:
            ├─ messageId (target message)
            ├─ from (reactor JID)
            ├─ chatJID
            ├─ emoji
            └─ timestamp
```

### 5.3 Reaction Storage

**File:** `apps/api/src/services/handlers/reaction-handlers.ts`

```typescript
handleReactionEvent(event: ReactionEvent)
    │
    ├─ Find message by WhatsApp message_id
    │
    ├─ If emoji present (add/update reaction):
    │   └─ UPSERT INTO message_reactions
    │       ├─ message_id (internal FK)
    │       ├─ reactor_jid
    │       └─ emoji
    │
    └─ If emoji empty (remove reaction):
        └─ DELETE FROM message_reactions
            └─ WHERE message_id = ? AND reactor_jid = ?
```

### 5.4 Reaction Database Schema

**Table:** `message_reactions` (per-tenant schema)

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `message_id` | UUID | FK to messages (internal ID) |
| `reactor_jid` | VARCHAR | JID of person who reacted |
| `emoji` | VARCHAR | The reaction emoji |
| `created_at` | TIMESTAMPTZ | When reaction was added |

---

## 6. Message Receipts (Delivery Status)

### 6.1 Receipt Types

WhatsApp sends receipt events for message status updates:

| WhatsApp Receipt | Database Status |
|------------------|-----------------|
| `sender` | `sent` |
| `delivered` | `delivered` |
| `read` | `read` |
| `played` | `read` |

### 6.2 Receipt Processing

**File:** `apps/api/src/services/handlers/message-handlers.ts`

```typescript
handleReceiptEvent(event: ReceiptEvent)
    │
    ├─ Map WhatsApp receipt type to DB enum
    │
    ├─ For each message ID in receipt:
    │   │
    │   ├─ Find message by WhatsApp message_id
    │   │
    │   └─ UPDATE messages SET status = ?
    │
    └─ Broadcast to WebSocket: message:status
```

---

## 7. Presence & Online Status

### 7.1 Presence Event Processing

**File:** `apps/api/src/services/handlers/contact-handlers.ts`

```typescript
handlePresenceEvent(event: PresenceEvent)
    │
    ├─ Normalize JID
    │
    ├─ Extract:
    │   ├─ isOnline = !unavailable
    │   └─ lastSeen timestamp
    │
    ├─ Update contact:
    │   ├─ is_online = isOnline
    │   └─ last_seen = lastSeen (only when going offline)
    │
    └─ Broadcast to WebSocket:
        ├─ presence:online or presence:offline
        └─ Include lastSeen if going offline
```

### 7.2 Presence Subscription

During history sync and on first message, the worker subscribes to presence updates:

```go
h.config.Client.SubscribePresence(ctx, normalizedJID)
```

This registers to receive future online/offline updates for that contact.

---

## 8. Profile Picture Sync

### 8.1 Profile Picture Sources

1. **History Sync** - Fetched for each contact during initial sync
2. **Real-time Event** - Updates when contact changes picture

### 8.2 Picture Processing

**File:** `services/whatsapp/internal/handler/media.go`

```go
fetchProfilePicture(jid)
    │
    ├─ Get profile picture info from WhatsApp API
    │   └─ Contains URL and ID
    │
    ├─ Download from WhatsApp URL (HTTP)
    │
    ├─ Upload to storage (R2/MinIO)
    │   └─ Path: profile-pictures/{jid}/{pictureId}.jpg
    │
    └─ Return storage URL
```

### 8.3 Profile Picture Event

```typescript
handleProfilePictureEvent(event)
    │
    └─ UPDATE contacts
        └─ SET profile_picture_url = event.payload.url
            WHERE jid = event.payload.jid
```

---

## 9. Deferred Media Download

### 9.1 Problem

History sync can contain thousands of media messages. Downloading all media during sync would be:
- Too slow
- Consume excessive bandwidth
- Block the sync process

### 9.2 Solution: Deferred Downloads

Store media metadata instead of downloading immediately:

| Field | Purpose |
|-------|---------|
| `media_direct_path` | WhatsApp's CDN path |
| `media_key` | Encryption key (base64) |
| `media_file_sha256` | File hash for verification |
| `media_file_enc_sha256` | Encrypted file hash |
| `media_download_status` | `pending` / `completed` / `failed` |

### 9.3 On-Demand Download Flow

When user opens a message with pending media:

```
Frontend requests media download
    │
    └─ POST /api/messages/{id}/download
        │
        └─ Publish download request → NATS (WHATSAPP.download.*)
            │
            └─ Go Worker receives request
                │
                ├─ Download from WhatsApp using stored metadata
                │
                ├─ Upload to R2/MinIO
                │
                └─ Publish download_response → NATS
                    │
                    └─ handleDownloadResponseEvent()
                        │
                        ├─ UPDATE messages SET media_url = ?
                        ├─ SET media_download_status = "completed"
                        │
                        └─ Broadcast: media:downloaded
```

---

## 10. Message Revocation (Deletion)

### 10.1 Revoke Detection

WhatsApp sends a protocol message with `REVOKE` type when a message is deleted:

```go
if protoMsg.GetProtocolMessage().GetType() == waProto.ProtocolMessage_REVOKE {
    revokedKey := protoMsg.GetProtocolMessage().GetKey()
    h.publisher.PublishMessageRevoke(revokedKey.GetId(), jid)
}
```

### 10.2 Revoke Processing

**File:** `apps/api/src/services/handlers/reaction-handlers.ts`

```typescript
handleMessageRevokeEvent(event: MessageRevokeEvent)
    │
    ├─ Find message by WhatsApp message_id
    │
    ├─ UPDATE messages:
    │   ├─ deleted_by_sender = true
    │   └─ deleted_at = NOW()
    │
    └─ Broadcast: message:deleted
```

---

## 11. Event Router

### 11.1 Central Dispatcher

**File:** `apps/api/src/services/message-handler.ts`

```typescript
initializeMessageHandler()
    │
    └─ subscribeToAllEvents("WHATSAPP.events.>")
        │
        └─ handleWhatsAppEvent(event)
            │
            └─ Switch on event.type:
                │
                ├─ Connection Events:
                │   ├─ "qr" → handleQREvent()
                │   ├─ "connected" → handleConnectedEvent()
                │   └─ "disconnected" → handleDisconnectedEvent()
                │
                ├─ Message Events:
                │   ├─ "message" → handleMessageEvent()
                │   ├─ "receipt" → handleReceiptEvent()
                │   └─ "send_confirmation" → handleSendConfirmationEvent()
                │
                ├─ Contact Events:
                │   ├─ "contact" → handleContactEvent()
                │   ├─ "profile_picture" → handleProfilePictureEvent()
                │   ├─ "presence" → handlePresenceEvent()
                │   └─ "typing" → handleTypingEvent()
                │
                ├─ Reaction & Revoke:
                │   ├─ "reaction" → handleReactionEvent()
                │   └─ "message_revoke" → handleMessageRevokeEvent()
                │
                └─ Status & Sync:
                    ├─ "status" → handleStatusEvent()
                    ├─ "sync_status" → handleSyncStatusEvent()
                    └─ "download_response" → handleDownloadResponseEvent()
```

---

## 12. Database Tables Summary

### Core Tables (per-tenant schema)

| Table | Purpose |
|-------|---------|
| `whatsapp_connections` | Connection metadata & status |
| `contacts` | Contact list (including groups) |
| `messages` | Message storage |
| `message_reactions` | Reaction data |
| `conversation_states` | Unread counts, last message |

### Key Foreign Keys

```
messages.contact_id → contacts.id
messages.whatsapp_connection_id → whatsapp_connections.id
message_reactions.message_id → messages.id
conversation_states.contact_id → contacts.id
```

### Important Indexes

```sql
-- Message queries
CREATE INDEX idx_messages_contact_timestamp
    ON messages (contact_id, timestamp DESC);

-- Deferred media
CREATE INDEX idx_messages_media_pending
    ON messages (media_download_status, created_at)
    WHERE media_download_status = 'pending';

-- Contacts
CREATE INDEX idx_contacts_jid ON contacts(jid);
CREATE INDEX idx_contacts_phone ON contacts(phone_number);
```

---

## 13. WebSocket Broadcasting

After database updates, events are broadcast to connected clients:

```typescript
broadcastToCompany(companyId, {
    type: 'message:new' | 'message:status' | 'contact' | 'presence:online' | etc,
    connectionId: connectionId,
    payload: { ... },
    timestamp: new Date().toISOString()
})
```

### WebSocket Event Types

| Event | Description |
|-------|-------------|
| `message:new` | New message received |
| `message:status` | Message status update (sent/delivered/read) |
| `message:deleted` | Message was revoked |
| `message:reaction` | Reaction added/removed |
| `media:downloaded` | Deferred media download completed |
| `contact` | Contact created/updated |
| `presence:online` | Contact came online |
| `presence:offline` | Contact went offline |
| `typing:start` | Contact started typing |
| `typing:stop` | Contact stopped typing |
| `sync:status` | History sync progress |

---

## 14. Key Files Reference

### Go WhatsApp Service

| File | Purpose |
|------|---------|
| `services/whatsapp/internal/handler/handler.go` | Main event dispatcher |
| `services/whatsapp/internal/handler/history_sync.go` | History sync orchestration |
| `services/whatsapp/internal/handler/messages.go` | Message handling |
| `services/whatsapp/internal/handler/media.go` | Media download/upload |
| `services/whatsapp/internal/handler/connection.go` | Presence/typing events |
| `services/whatsapp/internal/nats/publisher.go` | NATS event publishing |

### API Event Handlers

| File | Purpose |
|------|---------|
| `apps/api/src/services/message-handler.ts` | Event router |
| `apps/api/src/services/handlers/message-handlers.ts` | Message storage |
| `apps/api/src/services/handlers/contact-handlers.ts` | Contact storage |
| `apps/api/src/services/handlers/reaction-handlers.ts` | Reactions & revokes |
| `apps/api/src/services/handlers/status-handlers.ts` | Sync status & downloads |
| `apps/api/src/services/handlers/connection-handlers.ts` | Connection events |

### Shared Types

| File | Purpose |
|------|---------|
| `services/shared/nats/events.go` | Go event type definitions |
| `services/shared/nats/subjects.go` | NATS subject patterns |
| `apps/api/src/lib/nats/types/index.ts` | TypeScript event types |

### Database

| File | Purpose |
|------|---------|
| `packages/database/src/migrations/015_fix_tenant_schema_baseline.ts` | Core schema |
| `packages/database/src/migrations/023_add_deferred_media_download.ts` | Deferred media |
| `packages/database/src/migrations/024_add_sync_status_column.ts` | Sync tracking |

---

## 15. Performance Considerations

1. **Parallel Processing** - History sync uses 10 concurrent workers
2. **Rate Limiting** - 100ms delay between media downloads
3. **Deferred Media** - Don't download all media during sync
4. **Batch Indexing** - Search indexing happens in background
5. **Connection Pooling** - NATS handles reconnects automatically
6. **Index Usage** - Strategic indexes on frequently queried fields
7. **Deduplication** - Unique constraint prevents duplicate messages

---

## 16. Error Handling & Resilience

### Retry Mechanisms

| Operation | Strategy |
|-----------|----------|
| Media Downloads | Exponential backoff: 1s, 2s, 4s (max 4 attempts) |
| NATS Connection | Automatic reconnect |
| API Event Subscription | Retry on stream not found |
| History Sync | Worker pool continues on individual failures |

### Deduplication

Messages have unique constraint:
```sql
UNIQUE (whatsapp_connection_id, message_id)
```

Prevents duplicate storage if same message published twice.

---

## Related Documentation

- [WhatsApp Connection Flow](./whatsapp-connection-flow.md) - Initial connection and QR pairing
