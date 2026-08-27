# Tags API

> Base path: `/api/tags` · 4 endpoints

Workspace-local contact tags (distinct from WhatsApp labels). Simple synchronous CRUD against the tenant schema.

## Endpoints

**Methods:** GET 1 · POST 1 · DELETE 1 · PATCH 1 · PUT 0

| Method | Path | Access | Description |
|--------|------|--------|-------------|
| GET | `/tags/` | — | List all tags with optional pagination |
| POST | `/tags/` | — | Create a new tag |
| PATCH | `/tags/:id` | — | Update a tag |
| DELETE | `/tags/:id` | — | Delete a tag |

## Flows

### Tag CRUD

```mermaid
sequenceDiagram
    participant U as Agent
    participant A as API (Hono)
    participant D as Postgres (tenantDb)
    U->>A: POST /api/tags {name,color}
    A->>A: auth + tenant + zValidator
    A->>D: INSERT tag
    A-->>U: 201 {tag}
```

