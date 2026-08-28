# Invitations (token acceptance) API

> Base path: `/api/invitations` · 2 endpoints

Public token endpoints for previewing and accepting a workspace invitation. `GET /:token` is public; `POST /:token/accept` requires authentication but **no** tenant context (the user is not a member yet).

## Endpoints

**Methods:** GET 1 · POST 1 · DELETE 0 · PATCH 0 · PUT 0

| Method | Path | Access | Description |
|--------|------|--------|-------------|
| GET | `/invitations/:token` | Public | Get invitation details (for preview before accepting) |
| POST | `/invitations/:token/accept` | Authenticated | Accept invitation |

## Flows

### Accept invitation

```mermaid
sequenceDiagram
    participant U as Invited user
    participant A as API (Hono)
    participant S as company.service
    participant D as Postgres
    U->>A: GET /api/invitations/:token
    A->>S: getInvitationByToken(token)
    S->>D: SELECT invitation + company
    A-->>U: 200 {invitation preview}
    U->>A: POST /api/invitations/:token/accept (Bearer JWT)
    A->>S: acceptInvitation(token, userId)
    S->>D: validate + create membership in shared company_members
    A->>D: createAuditLog(invitation.accepted)
    A-->>U: 200 {company, member}
```
