# Health API

> Base path: `/api/health` · 3 endpoints

Infrastructure probes for Kubernetes/Docker: liveness, readiness, and overall status. Public (no auth). PostgreSQL, NATS, and the event consumer gate readiness; missing/unreachable Centrifugo reports `degraded` with HTTP 200 rather than making the API unready.

## Endpoints

**Methods:** GET 3 · POST 0 · DELETE 0 · PATCH 0 · PUT 0

| Method | Path | Access | Description |
|--------|------|--------|-------------|
| GET | `/health` | Public | Overall system health Used by orchestrators to check if the service is functioning |
| GET | `/health/live` | Public | Liveness probe Kubernetes uses this to determine if the pod should be restarted |
| GET | `/health/ready` | Public | Readiness probe Kubernetes uses this to determine if the pod is ready to receive traffic |

## Flows

### Readiness probe

```mermaid
sequenceDiagram
    participant K as K8s/Docker
    participant A as API (Hono)
    participant D as Postgres
    participant N as NATS
    K->>A: GET /api/health/ready
    A->>D: SELECT 1
    A->>N: connection + event-consumer state
    A->>A: probe Centrifugo (degraded only)
    A-->>K: 200 ready/degraded; 503 only when core checks are unready
```
