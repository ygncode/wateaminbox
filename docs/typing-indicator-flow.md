# Typing Indicator Flow

This document describes the complete flow of typing indicators in both directions:
1. **Outgoing**: User typing in web app → WhatsApp contact sees "typing..."
2. **Incoming**: WhatsApp contact typing → User sees "typing..." in web app

---

## OUTGOING FLOW (Web → WhatsApp)

### Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Frontend      │────▶│   Hono API      │────▶│   Go WhatsApp   │────▶│   WhatsApp      │
│   (React)       │ WS  │   (WebSocket)   │NATS │   Service       │     │   Server        │
└─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘
```

## Step-by-Step Flow

### Step 1: Frontend Emission (MessageComposer.tsx)

**File:** `apps/web/src/components/chat/MessageComposer.tsx`

When user types in the message composer:

```typescript
// On input change:
const jid = conversationId.includes("@")
  ? conversationId
  : `${conversationId}@s.whatsapp.net`;

sendTypingStart(jid);  // Emits typing:start
// After 3 seconds of no typing:
sendTypingStop(jid);   // Emits typing:stop
```

**Debug:** Check browser console for WebSocket messages being sent.

### Step 2: useWebSocket Hook

**File:** `apps/web/src/hooks/useWebSocket.ts`

The hook provides `sendTypingStart` and `sendTypingStop` methods:

```typescript
const sendTypingStart = useCallback(
  (conversationId: string) => {
    connection.send("typing:start", { conversationId });
  },
  [connection.send],
);

const sendTypingStop = useCallback(
  (conversationId: string) => {
    connection.send("typing:stop", { conversationId });
  },
  [connection.send],
);
```

**Debug:** Add `console.log` in these methods to verify they're called.

### Step 3: WebSocket Client Send

**File:** `apps/web/src/lib/websocket.ts`

The `send` method sends the message over WebSocket:

```typescript
send<T>(type: string, payload: T): boolean {
  if (this.isSocketReady()) {
    return this.sendImmediate(type, payload);
  }
  // Returns false if not connected
}
```

**Message format sent over WebSocket:**
```json
{
  "type": "typing:start",
  "payload": {
    "conversationId": "1234567890@s.whatsapp.net"
  }
}
```

**Debug:** Check browser Network tab → WS → Messages to see outgoing frames.

### Step 4: API WebSocket Handler

**File:** `apps/api/src/routes/ws/handlers.ts`

The API receives the WebSocket message and routes it:

```typescript
case 'typing:start':
  await handleTypingMessage(ws, parsed.payload, true)
  break

case 'typing:stop':
  await handleTypingMessage(ws, parsed.payload, false)
  break
```

The `handleTypingMessage` function:

```typescript
async function handleTypingMessage(
  ws: WebSocketConnection,
  payload: unknown,
  isTyping: boolean
): Promise<void> {
  if (!ws.data.authenticated) return;

  const typingPayload = payload as { conversationId?: string }
  if (!typingPayload?.conversationId) {
    logger.debug('Typing message missing conversationId')
    return
  }

  const tenantDb = getTenantConnection(ws.data.companyId)
  const connection = await getActiveConnection(tenantDb)

  if (!connection) return;  // No active WhatsApp connection

  await publishTypingCommand(
    ws.data.companyId,
    connection.id,
    typingPayload.conversationId,  // This is the JID
    isTyping
  )
}
```

**Debug:** Add logging in this function to verify it's being called and has valid data.

### Step 5: NATS Publishing

**File:** `apps/api/src/lib/nats/client.ts`

The `publishTypingCommand` function publishes to NATS JetStream:

```typescript
export async function publishTypingCommand(
  companyId: string,
  connectionId: string,
  jid: string,
  isTyping: boolean
): Promise<void> {
  const typingCommand = {
    type: isTyping ? "typing_start" : "typing_stop",
    jid,
  }

  const js = await getJetStreamClient()
  const subject = buildCommandSubject(companyId, connectionId)
  // Subject format: WHATSAPP.commands.{companyId}.{connectionId}
  const data = jc.encode(typingCommand)
  await js.publish(subject, data)
}
```

**NATS Message format:**
```json
{
  "type": "typing_start",
  "jid": "1234567890@s.whatsapp.net"
}
```

**Debug:** Check API logs for "Published typing command" messages.

### Step 6: Go NATS Subscriber

**File:** `services/whatsapp/internal/nats/subscriber.go`

The Go service subscribes to command subjects and routes by type:

```go
func (s *Subscriber) handleCommand(msg *nats.Msg) {
    var ct commandType
    json.Unmarshal(msg.Data, &ct)

    switch ct.Type {
    case "typing_start", "typing_stop":
        s.handleTypingCommand(msg, ct.Type)
    // ...
    }
}
```

The `handleTypingCommand` function:

```go
func (s *Subscriber) handleTypingCommand(msg *nats.Msg, cmdType string) {
    var cmd TypingCommand
    json.Unmarshal(msg.Data, &cmd)

    if s.typingSender == nil {
        log.Printf("Typing command received but typingSender not configured")
        msg.Ack()
        return
    }

    isTyping := cmdType == "typing_start"
    log.Printf("Processing typing command: jid=%s, isTyping=%v", cmd.JID, isTyping)

    ctx, cancel := context.WithTimeout(s.ctx, 5*time.Second)
    defer cancel()

    if err := s.typingSender.SendChatPresence(ctx, cmd.JID, isTyping); err != nil {
        log.Printf("Failed to send chat presence: %v", err)
    }

    msg.Ack()
}
```

**Debug:** Check Go service logs for "Processing typing command" messages.

### Step 7: WhatsApp Client

**File:** `services/whatsapp/internal/client/client.go`

The `SendChatPresence` method sends the typing indicator to WhatsApp:

```go
func (c *Client) SendChatPresence(ctx context.Context, jidStr string, isTyping bool) error {
    jid, err := types.ParseJID(jidStr)
    if err != nil {
        return fmt.Errorf("invalid JID: %w", err)
    }

    state := waTypes.ChatPresencePaused
    if isTyping {
        state = waTypes.ChatPresenceComposing
    }

    if err := c.client.SendChatPresence(ctx, jid, state, waTypes.ChatPresenceMediaText); err != nil {
        return fmt.Errorf("failed to send chat presence: %w", err)
    }

    return nil
}
```

**Debug:** Check Go service logs for any errors from `SendChatPresence`.

### Step 8: main.go Wiring

**File:** `services/whatsapp/main.go`

The `TypingSender` interface must be wired in main.go:

```go
subscriber, err := natsClient.NewSubscriber(natsClient.SubscriberConfig{
    NATSURL:      natsURL,
    CompanyID:    companyID,
    ConnectionID: connectionID,
    Sender:       waClient,
    Blocker:      waClient,
    TypingSender: waClient,  // <-- This must be set
    Publisher:    publisher,
})
```

**Debug:** Verify this line exists and `waClient` implements `TypingSender` interface.

## Debugging Checklist

### Frontend
- [ ] Browser console shows no errors
- [ ] Network tab → WS shows `typing:start`/`typing:stop` messages being sent
- [ ] `conversationId` is a valid JID (has `@s.whatsapp.net` or `@g.us` suffix)

### API (Hono)
- [ ] WebSocket connection is authenticated
- [ ] Active WhatsApp connection exists for the company
- [ ] NATS is connected
- [ ] Check API logs for typing-related messages

### Go Service
- [ ] NATS subscriber is running
- [ ] `TypingSender` is configured (not nil)
- [ ] Check logs for "Processing typing command" messages
- [ ] Check for any errors from `SendChatPresence`

### NATS
- [ ] JetStream is running
- [ ] `WHATSAPP_COMMANDS` stream exists
- [ ] Consumer exists for the connection

## Common Issues

### 1. JID Format
The JID must be in correct format:
- Individual chats: `1234567890@s.whatsapp.net`
- Group chats: `1234567890-1234567890@g.us`

If `conversationId` is just a phone number, it needs the suffix added.

### 2. No Active Connection
If there's no active WhatsApp connection, typing commands are silently dropped in the API handler.

### 3. TypingSender Not Configured
If `TypingSender` is nil in the subscriber, typing commands are acked but not processed.

### 4. WebSocket Not Connected
If the WebSocket is not connected/authenticated, `send()` returns false silently.

### 5. NATS Consumer Not Subscribed
The Go service must be running and subscribed to the correct subject pattern.

## Log Locations

| Component | Log Location |
|-----------|--------------|
| Frontend | Browser DevTools Console |
| API | Terminal running `bun run dev` |
| Go Service | Terminal running `go run main.go` |
| NATS | NATS server logs |

## Testing Commands

### Check NATS Stream
```bash
nats stream info WHATSAPP_COMMANDS
```

### Check NATS Consumer
```bash
nats consumer info WHATSAPP_COMMANDS whatsapp-send-{companyId}-{connectionId}
```

### Monitor NATS Messages
```bash
nats sub "WHATSAPP.commands.>"
```

---

## INCOMING FLOW (WhatsApp → Web)

### Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   WhatsApp      │────▶│   Go WhatsApp   │────▶│   Hono API      │────▶│   Frontend      │
│   Server        │     │   Service       │NATS │   (WebSocket)   │ WS  │   (React)       │
└─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘
```

### Step 1: WhatsApp Client Receives ChatPresence Event

**File:** `services/whatsapp/internal/handler/handler.go`

The whatsmeow client receives `events.ChatPresence` when a contact starts/stops typing:

```go
case *events.ChatPresence:
    h.handleChatPresence(v)
```

### Step 2: Go Handler Processes ChatPresence

**File:** `services/whatsapp/internal/handler/connection.go`

```go
func (h *Handler) handleChatPresence(presence *events.ChatPresence) {
    senderJID := presence.Sender.ToNonAD()
    chatJID := presence.Chat.ToNonAD()

    // ChatPresence.State is "composing" when typing, "paused" when stopped
    isTyping := presence.State == types.ChatPresenceComposing

    log.Printf("Typing indicator from %s in %s: typing=%v",
        senderJID.String(), chatJID.String(), isTyping)

    typingEvent := natsClient.TypingEvent{
        From:      senderJID.String(),
        ChatJID:   chatJID.String(),
        IsTyping:  isTyping,
        MediaType: mediaType,
        Timestamp: time.Now(),
    }

    // Publish to NATS
    h.publisher.PublishTyping(typingEvent)
}
```

**Debug:** Check Go service logs for "Typing indicator from..." messages.

### Step 3: Go Publisher Sends to NATS

**File:** `services/whatsapp/internal/nats/publisher.go`

```go
func (p *Publisher) PublishTyping(typing TypingEvent) error {
    event := WhatsAppEvent{
        Type:         "typing",  // <-- Event type
        CompanyID:    p.companyID,
        ConnectionID: p.connectionID,
        Payload: TypingPayload{
            From:      typing.From,
            ChatJID:   typing.ChatJID,
            IsTyping:  typing.IsTyping,
            MediaType: typing.MediaType,
        },
        Timestamp: time.Now().Format(time.RFC3339),
    }

    subject := fmt.Sprintf(SubjectTyping, p.companyID, p.connectionID)
    // Subject: WHATSAPP.events.{companyId}.{connectionId}.typing
    return p.publish(subject, event)
}
```

**NATS Event format:**
```json
{
  "type": "typing",
  "company_id": "xxx",
  "connection_id": "yyy",
  "payload": {
    "from": "1234567890@s.whatsapp.net",
    "chat_jid": "1234567890@s.whatsapp.net",
    "is_typing": true,
    "media_type": "text"
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### Step 4: API Message Handler Receives Event

**File:** `apps/api/src/services/message-handler.ts`

The API subscribes to all WhatsApp events and routes by type:

```typescript
switch (type) {
  case "typing":
    await handleTypingEvent(event as TypingEvent);
    break;
  // ...
}
```

### Step 5: API Typing Handler Broadcasts to WebSocket

**File:** `apps/api/src/services/handlers/contact-handlers.ts`

```typescript
export async function handleTypingEvent(event: TypingEvent): Promise<void> {
  const { companyId, connectionId, payload } = event

  logger.debug({
    companyId,
    connectionId,
    from: payload.from,
    isTyping: payload.isTyping,
  }, 'Typing event received')

  // Broadcast to WebSocket clients
  broadcastToCompany(companyId, {
    type: payload.isTyping ? 'typing:start' : 'typing:stop',
    connectionId,
    payload: {
      conversationId: payload.chatJid || payload.from,
      userId: payload.from,
      userName: payload.from,
    },
    timestamp: event.timestamp,
  })
}
```

**WebSocket message format:**
```json
{
  "type": "typing:start",
  "connectionId": "yyy",
  "payload": {
    "conversationId": "1234567890@s.whatsapp.net",
    "userId": "1234567890@s.whatsapp.net",
    "userName": "1234567890@s.whatsapp.net"
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**Debug:** Check API logs for "Typing event received" messages.

### Step 6: Frontend WebSocket Handler

**File:** `apps/web/src/hooks/websocket/useWebSocketEvents.ts`

The frontend subscribes to typing events:

```typescript
// Subscribe to typing:start and typing:stop events
connection.subscribe("typing:start", handleTypingStart);
connection.subscribe("typing:stop", handleTypingStop);
```

### Step 7: Frontend Typing Indicators Hook

**File:** `apps/web/src/hooks/websocket/useTypingIndicators.ts`

```typescript
const handleTypingStart = useCallback((payload) => {
  if ("jid" in payload) {
    // WhatsApp typing event
    addTypingIndicator({
      conversationId: payload.jid,
      userId: payload.jid,
      userName: "",
      startedAt: new Date(),
    });
    setTypingTimeout(payload.jid, payload.jid);
  }
}, []);
```

### Step 8: Chat Store Updates UI

**File:** `apps/web/src/stores/chat-store.ts`

The typing indicator is stored in the chat store and the UI renders it.

---

## Incoming Flow Debugging Checklist

### Go Service
- [ ] Check logs for "Typing indicator from..." (Step 2)
- [ ] Check logs for NATS publish success
- [ ] Verify `events.ChatPresence` is being received (may need to enable debug logging in whatsmeow)

### API
- [ ] Check logs for "Received WhatsApp event" with `type: "typing"`
- [ ] Check logs for "Typing event received" (Step 5)
- [ ] Verify `broadcastToCompany` is called

### Frontend
- [ ] Check browser DevTools → Network → WS for incoming `typing:start`/`typing:stop` messages
- [ ] Check React DevTools for typing indicators in chat store
- [ ] Verify the UI component renders the typing indicator

---

## Common Issues - Incoming

### 1. ChatPresence Events Not Received
WhatsApp only sends ChatPresence events if:
- The client has sent `PresenceAvailable` to the server
- The client is actively monitoring presence for that contact

**Check:** Is `SendPresence(ctx, types.PresenceAvailable)` called after connection?

### 2. NATS Subject Mismatch
The event subject must match what the API subscribes to:
- Publisher: `WHATSAPP.events.{companyId}.{connectionId}.typing`
- Subscriber: `WHATSAPP.events.>` (wildcard)

### 3. WebSocket Subscription Not Set Up
Ensure `useWebSocketEvents` hook is:
- Mounted in the component tree
- Subscribing to `typing:start` and `typing:stop` events

### 4. Chat Store Not Updating
The typing indicator may be added but the UI might not be subscribed to changes.

---

## Monitor Commands

### Monitor all NATS events (incoming)
```bash
nats sub "WHATSAPP.events.>"
```

### Monitor typing-specific events
```bash
nats sub "WHATSAPP.events.*.*.typing"
```

### Monitor outgoing commands
```bash
nats sub "WHATSAPP.commands.>"
```
