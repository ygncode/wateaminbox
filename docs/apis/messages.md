# Messages API

> Base path: `/api/messages`, `/api/messages/batch` · 15 endpoints

Sending, fetching, reacting to, starring, and scheduling messages, plus batch operations. Sending is **asynchronous**: the message is stored `pending`, a command is enqueued, and delivery/status updates flow back through NATS and the WhatsApp worker.

## Endpoints

**Methods:** GET 3 · POST 8 · DELETE 4 · PATCH 0 · PUT 0

| Method | Path | Access | Description |
|--------|------|--------|-------------|
| GET | `/messages` | Authenticated · Tenant context · Contact visibility (result-filtered) | Get messages for a contact |
| POST | `/messages` | Authenticated · Tenant context · `can_send_messages` · Rate limited | Queue a message for delivery and return the pending message (200) |
| DELETE | `/messages/:id` | Authenticated · Tenant context · `can_delete` · Message visibility | Soft delete a message |
| POST | `/messages/:id/forward` | Authenticated · Tenant context · Message visibility · `can_send_messages` · Rate limited | Forward a message to another contact |
| DELETE | `/messages/:id/reaction` | Authenticated · Tenant context · Message visibility · `can_send_messages` | Remove a reaction from a message |
| POST | `/messages/:id/reaction` | Authenticated · Tenant context · Message visibility · `can_send_messages` | Add a reaction to a message |
| POST | `/messages/:id/retry` | Authenticated · Tenant context · Message visibility · `can_send_messages` · Rate limited | Retry a failed message |
| DELETE | `/messages/:id/star` | Authenticated · Tenant context · Message visibility | Unstar a message |
| POST | `/messages/:id/star` | Authenticated · Tenant context · Message visibility | Star a message |
| POST | `/messages/batch/delete` | Authenticated · Tenant context · `can_delete` · Message visibility (all selected) | Soft delete multiple messages at once |
| POST | `/messages/batch/star` | Authenticated · Tenant context · Message visibility (all selected) | Star/unstar multiple messages at once |
| GET | `/messages/scheduled` | Authenticated · Tenant context · Contact visibility (result-filtered) | List a conversation's scheduled messages |
| POST | `/messages/scheduled` | Authenticated · Tenant context · `can_send_messages` · Rate limited | Schedule a message for future delivery |
| DELETE | `/messages/scheduled/:id` | Authenticated · Tenant context · `can_send_messages` | Cancel a scheduled message Only rows that have not started dispatching (or already failed) can be canceled; a row being processed is past the point of no return. |
| GET | `/messages/starred` | Authenticated · Tenant context · Contact visibility (result-filtered) | Get all starred messages |

## Flows

### Send message (async)

```mermaid
sequenceDiagram
    participant U as Agent
    participant A as API (Hono)
    participant D as Postgres (tenantDb)
    participant O as Command Outbox
    participant N as NATS (JetStream)
    participant W as WhatsApp Worker
    participant WA as WhatsApp
    participant R as Centrifugo
    U->>A: POST /api/messages {contactId, content}
    A->>A: requireMessageSendPermission + rate limit + validate
    A->>D: lookup contact + active connection
    A->>D: transaction: insert message (status=pending) + enqueue command
    A->>R: broadcast message:new (pending) to viewers
    A-->>U: 200 {message (pending)}
    O->>N: publish connection command subject
    N->>W: worker consumes command directly
    W->>WA: send text/media
    WA-->>W: ack/send receipt
    W->>N: publish receipt/send_confirmation event
    N->>A: event subscriber (message-handler)
    A->>D: update message status (sent/delivered/read)
    A->>R: broadcast message:status to viewers
```

### Inbound message

```mermaid
sequenceDiagram
    participant WA as WhatsApp
    participant W as WhatsApp Worker
    participant N as NATS
    participant A as API (event subscriber)
    participant D as Postgres (tenantDb)
    participant R as Centrifugo
    WA-->>W: incoming message event
    W->>N: publish message event
    N->>A: message-handler
    A->>D: upsert contact + insert message
    A->>R: broadcast message:new to authorized viewers
    R-->>U: websocket push
```
