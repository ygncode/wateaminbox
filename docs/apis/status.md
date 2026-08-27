# Status (Stories) API

> Base path: `/api/status` · 6 endpoints

WhatsApp Status (stories) posting and reading. Posting is asynchronous via the worker; status events are broadcast workspace-wide by policy.

## Endpoints

**Methods:** GET 4 · POST 1 · DELETE 1 · PATCH 0 · PUT 0

| Method | Path | Access | Description |
|--------|------|--------|-------------|
| GET | `/status/` | — | List all status updates (not expired) |
| POST | `/status/` | — | Post a new status update |
| DELETE | `/status/:id` | — | Delete a posted status |
| GET | `/status/:jid` | — | Get all status updates from a specific contact |
| GET | `/status/my` | — | Get my posted status updates |
| GET | `/status/stats/overview` | — | Get status statistics |

## Flows

### Post status

```mermaid
sequenceDiagram
    participant U as Agent
    participant A as API (Hono)
    participant D as Postgres (tenantDb)
    participant N as NATS
    participant W as WhatsApp Worker
    participant WA as WhatsApp
    U->>A: POST /api/status {content, mediaUrl?}
    A->>D: enqueue post_status command
    A-->>U: 202
    N->>W: post_status
    W->>WA: upload + publish status
    WA-->>W: result -> status event
    N->>A: persist status_updates
```

