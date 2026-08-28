# Actions (realtime REST) API

> Base path: `/api/actions` · 2 endpoints

Lightweight realtime REST actions. Read is a visibility-checked Centrifugo signal only; it does not persist read state or command WhatsApp. Typing broadcasts to authorized realtime viewers while publishing the worker/WhatsApp command in parallel.

## Endpoints

**Methods:** GET 0 · POST 2 · DELETE 0 · PATCH 0 · PUT 0

| Method | Path | Access | Description |
|--------|------|--------|-------------|
| POST | `/actions/messages/read` | Authenticated · Tenant context · Contact visibility | Broadcast a visibility-checked realtime read signal only |
| POST | `/actions/messages/typing` | Authenticated · Tenant context · `can_send_messages` · Send access for typing start | Broadcast realtime typing and publish a WhatsApp typing command in parallel |

## Flows

### Typing indicator

```mermaid
sequenceDiagram
    participant U as Agent
    participant A as API (Hono)
    participant N as NATS
    participant W as WhatsApp Worker
    participant WA as WhatsApp
    participant R as Centrifugo
    U->>A: POST /api/actions/messages/typing
    A->>A: validate contact/JID + send access for typing:start
    par realtime signal
        A->>R: typing:start/stop to authorized viewers
    and WhatsApp command
        A->>N: publish typing command (ephemeral)
        N->>W: worker consumes command
        W->>WA: send presence update
    end
```
