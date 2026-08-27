# Catalogs API

> Base path: `/api/catalogs` · 9 endpoints

WhatsApp Commerce catalogs: list catalogs and products, sync from WhatsApp, and toggle product visibility. Sync is asynchronous via the worker.

## Endpoints

**Methods:** GET 4 · POST 4 · DELETE 0 · PATCH 1 · PUT 0

| Method | Path | Access | Description |
|--------|------|--------|-------------|
| GET | `/catalogs` | Authenticated · Tenant context · `can_manage_connections` | List all WhatsApp Business catalogs |
| GET | `/catalogs/:catalogId` | Authenticated · Tenant context · `can_manage_connections` | Get a specific catalog |
| POST | `/catalogs/:catalogId/archive` | Authenticated · Tenant context · `can_manage_connections` | Archive a catalog |
| GET | `/catalogs/:catalogId/products` | Authenticated · Tenant context · `can_manage_connections` | Get products for a catalog |
| PATCH | `/catalogs/:catalogId/products/:productId/visibility` | Authenticated · Tenant context · `can_manage_connections` | Update product visibility |
| POST | `/catalogs/:catalogId/restore` | Authenticated · Tenant context · `can_manage_connections` | Restore an archived catalog |
| POST | `/catalogs/:catalogId/sync-products` | Authenticated · Tenant context · `can_manage_connections` | Queue a product sync request (200) |
| GET | `/catalogs/status` | Authenticated · Tenant context · `can_manage_connections` | Get catalog sync status summary |
| POST | `/catalogs/sync` | Authenticated · Tenant context · `can_manage_connections` | Queue a catalog sync request (200) |

## Flows

### Sync catalog

```mermaid
sequenceDiagram
    participant U as Agent
    participant A as API (Hono)
    participant D as Postgres (tenantDb)
    participant N as NATS
    participant W as WhatsApp Worker
    participant WA as WhatsApp
    participant R as Centrifugo
    U->>A: POST /api/catalogs/sync
    A->>D: enqueue sync_catalogs command
    A-->>U: 200 {data: {status: syncing}}
    N->>W: command
    W->>WA: fetch catalogs
    WA-->>W: catalog list
    W->>N: catalogs event
    N->>A: persist + broadcast catalogs:updated
```
