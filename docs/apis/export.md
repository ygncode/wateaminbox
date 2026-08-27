# Export API

> Base path: `/api/export` · 5 endpoints

Data export: contacts, messages, full workspace, single conversation, and bulk exports. Requires `can_export`.

## Endpoints

**Methods:** GET 4 · POST 1 · DELETE 0 · PATCH 0 · PUT 0

| Method | Path | Access | Description |
|--------|------|--------|-------------|
| POST | `/export/bulk` | Rate limited | Bulk export with custom filters |
| GET | `/export/contacts` | Rate limited | Export contacts |
| GET | `/export/conversation/:contactId` | Contact visibility · Rate limited | Export conversation for a specific contact |
| GET | `/export/full` | `can_view_all_chats` · Rate limited | Full backup as ZIP file |
| GET | `/export/messages` | Rate limited | Export messages |

## Flows

### Export flow

```mermaid
sequenceDiagram
    participant U as Agent
    participant A as API (Hono)
    participant S as export.service
    participant D as Postgres (tenantDb)
    U->>A: GET /api/export/contacts
    A->>A: requirePermission(can_export)
    A->>S: build CSV
    S->>D: stream rows
    S-->>A: CSV bytes
    A-->>U: 200 (text/csv)
```

