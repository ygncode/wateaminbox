# Debug (NATS) API

> Base path: `/api/debug` · 5 endpoints

Development-only NATS inspection endpoints (status, consumers, stream statistics, trace guidance, and help). The messages endpoint does not read message content: it returns stream counters plus CLI instructions. These routes return 403 in production.

## Endpoints

**Methods:** GET 5 · POST 0 · DELETE 0 · PATCH 0 · PUT 0

| Method | Path | Access | Description |
|--------|------|--------|-------------|
| GET | `/debug/nats/consumers/:stream` | Public | Get consumer info for a stream |
| GET | `/debug/nats/help` | Public | Shows available debugging commands and endpoints |
| GET | `/debug/nats/messages/:stream` | Public | Get stream statistics and CLI inspection instructions (not message content) |
| GET | `/debug/nats/status` | Public | Get NATS connection status and stream info |
| GET | `/debug/nats/trace/:correlationId` | Public | Provides instructions for tracing a correlation ID |

## Flows

### NATS inspection

```mermaid
sequenceDiagram
    participant U as Developer
    participant A as API (Hono)
    participant N as NATS
    U->>A: GET /api/debug/nats/messages/:stream
    A->>N: fetch stream info only
    A-->>U: 200 {stream, stats, instructions}
```
