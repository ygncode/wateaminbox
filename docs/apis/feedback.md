# Feedback API

> Base path: `/api/feedback` · 1 endpoints

Public feedback submission. Unauthenticated, body-bounded, and emailed to the product address.

## Endpoints

**Methods:** GET 0 · POST 1 · DELETE 0 · PATCH 0 · PUT 0

| Method | Path | Access | Description |
|--------|------|--------|-------------|
| POST | `/feedback/` | — | Submit feedback Public endpoint, no authentication required |

## Flows

### Submit feedback

```mermaid
sequenceDiagram
    participant U as Any user
    participant A as API (Hono)
    participant M as Mail driver
    U->>A: POST /api/feedback {message, email?}
    A->>A: zValidator (bounded) + escape HTML
    A->>M: sendEmail(contact@wateaminbox.com)
    A-->>U: 200 {message}
```

