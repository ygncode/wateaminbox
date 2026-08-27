# Bulk Broadcast Jobs API

> Base path: `/api/bulk-jobs` · 7 endpoints

Bulk broadcast campaigns: create, preview, schedule, cancel, and track recipients. Creation requires `can_send_bulk_messages`; delivery fans out to each recipient through the same async send path as single messages.

## Endpoints

**Methods:** GET 3 · POST 3 · DELETE 0 · PATCH 1 · PUT 0

| Method | Path | Access | Description |
|--------|------|--------|-------------|
| POST | `/bulk-jobs/` | `can_send_messages` · Rate limited | Create a job and snapshot its recipients. Idempotent via idempotencyKey; drift between the previewed and current audience returns 409 with a fresh preview for re-confirmation. |
| GET | `/bulk-jobs/` | — | List jobs (newest first) with derived progress. |
| GET | `/bulk-jobs/:id` | — | Job detail with derived progress. |
| POST | `/bulk-jobs/:id/cancel` | `can_send_messages` · Rate limited | Cancel a job's unsent recipients. Leaves already claimed by a dispatcher finish under their fencing token. |
| GET | `/bulk-jobs/:id/recipients` | — | Paginated per-recipient outcomes. |
| PATCH | `/bulk-jobs/:id/schedule` | `can_send_messages` · Rate limited | Move a truly not-started broadcast. The service updates the parent and already-materialized leaves in one guarded transaction; dispatch/cancel races return a controlled conflict. |
| POST | `/bulk-jobs/preview` | `can_send_messages` · Rate limited | Resolve the audience an exact job would target. |

## Flows

### Bulk job lifecycle

```mermaid
sequenceDiagram
    participant U as Agent
    participant A as API (Hono)
    participant D as Postgres (tenantDb)
    participant S as bulk-job.service
    participant N as NATS
    participant R as Centrifugo
    U->>A: POST /api/bulk-jobs {recipients, content}
    A->>A: requirePermission(can_send_bulk_messages)
    A->>S: createBulkJob
    S->>D: insert bulk_job + recipients
    A-->>U: 201 {job}
    S->>N: fan out send commands per recipient
    loop each recipient
        N->>N: send_message command
    end
    S->>R: broadcast bulk_job:updated
```

