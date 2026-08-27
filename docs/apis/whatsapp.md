# WhatsApp Connections & Status API

> Base path: `/api/whatsapp`, `/api/whatsapp/connections` · 20 endpoints

Multi-connection management (list/create/rename/archive/purge/reconnect/relink/disconnect) plus legacy single-connection endpoints. Connecting is **asynchronous**: a worker is spawned, a QR code is produced and pushed in realtime, and the scan completes the pairing.

## Endpoints

**Methods:** GET 8 · POST 10 · DELETE 1 · PATCH 1 · PUT 0

| Method | Path | Access | Description |
|--------|------|--------|-------------|
| POST | `/whatsapp/connect` | Authenticated · Tenant context · `can_manage_connections` | Start WhatsApp connection flow (backward compatible) QR codes are delivered on the authenticated company Centrifugo channel. |
| GET | `/whatsapp/connection` | Authenticated · Tenant context | Get detailed connection info (backward compatible) |
| GET | `/whatsapp/connections` | Authenticated · Tenant context | List all WhatsApp connections |
| POST | `/whatsapp/connections` | Authenticated · Tenant context · `can_manage_connections` | Create a new WhatsApp connection |
| DELETE | `/whatsapp/connections/:connectionId` | Authenticated · Tenant context · `can_manage_connections` | Archive the stable account and unlink its current WhatsApp session. Historical inbox data is retained. |
| GET | `/whatsapp/connections/:connectionId` | Authenticated · Tenant context | Get specific connection details |
| PATCH | `/whatsapp/connections/:connectionId` | Authenticated · Tenant context · `can_manage_connections` | Update connection (e.g., rename) |
| POST | `/whatsapp/connections/:connectionId/disconnect` | Authenticated · Tenant context · `can_manage_connections` | Disconnect specific connection |
| POST | `/whatsapp/connections/:connectionId/purge` | Authenticated · Tenant context · `can_manage_connections` · `can_delete` | Permanently erase an archived account and all of its inbox data. |
| POST | `/whatsapp/connections/:connectionId/reconnect` | Authenticated · Tenant context · `can_manage_connections` | Reconnect a disconnected connection |
| POST | `/whatsapp/connections/:connectionId/relink` | Authenticated · Tenant context · `can_manage_connections` | Initiate a new pairing session for an archived connection |
| POST | `/whatsapp/connections/:connectionId/send` | Authenticated · Tenant context · `can_send_messages` · Legacy removed | Removed legacy send endpoint; always returns 410 (use `POST /messages`) |
| GET | `/whatsapp/connections/:connectionId/status` | Authenticated · Tenant context | Get specific connection status |
| GET | `/whatsapp/connections/archived` | Authenticated · Tenant context · `can_manage_connections` | List archived connections |
| POST | `/whatsapp/disconnect` | Authenticated · Tenant context · `can_manage_connections` | Disconnect WhatsApp (backward compatible) Disconnects the first active connection |
| GET | `/whatsapp/limits` | Authenticated · Tenant context | Get connection limits for the company |
| POST | `/whatsapp/send` | Authenticated · Tenant context · `can_send_messages` · Legacy removed | Removed legacy send endpoint; always returns 410 (use `POST /messages`) |
| GET | `/whatsapp/status` | Authenticated · Tenant context | Get WhatsApp connection status (backward compatible) |
| POST | `/whatsapp/sync-reset` | Authenticated · Tenant context | Resets sync status for all connections (failsafe for stuck syncs) |
| GET | `/whatsapp/sync-status` | Authenticated · Tenant context | Gets sync status for all connections (for page reload handling) |

## Flows

### Create connection & QR pairing

```mermaid
sequenceDiagram
    participant U as Agent
    participant A as API (Hono)
    participant D as Postgres (tenantDb)
    participant N as NATS
    participant OC as Orchestrator
    participant W as WhatsApp Worker
    participant WA as WhatsApp
    participant R as Centrifugo
    U->>A: POST /api/whatsapp/connections
    A->>A: requirePermission(can_manage_connections)
    A->>D: advisory-lock count check + insert pending connection
    A->>D: enqueue spawn command
    A-->>U: 201 {connection (pending)}
    N->>OC: spawn command
    OC->>W: launch worker process
    W->>WA: connect (await QR)
    WA-->>W: QR code
    W->>N: QR event
    N->>A: store QR + expire time
    A->>R: broadcast `qr` to workspace
    R-->>U: show QR code
    U->>WA: scan QR on phone
    WA-->>W: connected
    W->>N: connection event
    N->>A: update status -> connected
    A->>R: broadcast `connected`
```

### Disconnect (kill)

```mermaid
sequenceDiagram
    participant U as Agent
    participant A as API (Hono)
    participant D as Postgres (tenantDb)
    participant N as NATS
    participant OC as Orchestrator
    participant W as WhatsApp Worker
    U->>A: POST /api/whatsapp/connections/:id/disconnect
    A->>D: update status -> disconnected + enqueue kill command
    A-->>U: 200
    N->>OC: kill command
    OC->>W: terminate worker
```
