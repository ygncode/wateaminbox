# Quick Replies API

> Base path: `/api/quick-replies` · 6 endpoints

Canned/shortcut replies. Synchronous CRUD; `GET /search/:shortcut` lets the composer resolve a shortcut to its expansion.

## Endpoints

**Methods:** GET 3 · POST 1 · DELETE 1 · PATCH 1 · PUT 0

| Method | Path | Access | Description |
|--------|------|--------|-------------|
| GET | `/quick-replies` | Authenticated · Tenant context | List all quick replies |
| POST | `/quick-replies` | Authenticated · Tenant context | Create a new quick reply |
| DELETE | `/quick-replies/:id` | Authenticated · Tenant context | Delete a quick reply |
| GET | `/quick-replies/:id` | Authenticated · Tenant context | Get a quick reply by ID |
| PATCH | `/quick-replies/:id` | Authenticated · Tenant context | Update a quick reply |
| GET | `/quick-replies/search/:shortcut` | Authenticated · Tenant context | Search by shortcut (for autocomplete) |

## Flows

### Quick reply CRUD & lookup

```mermaid
sequenceDiagram
    participant U as Agent
    participant A as API (Hono)
    participant D as Postgres (tenantDb)
    U->>A: POST /api/quick-replies {shortcut, text}
    A->>D: INSERT quick_reply
    A-->>U: 201
    U->>A: GET /api/quick-replies/search/:shortcut
    A->>D: SELECT by shortcut
    A-->>U: 200 {text}
```
