# WATeamInbox API Documentation

Detailed, group-by-group API reference for `apps/api` (the OSS API service). Every group file lists its endpoints with access controls and includes Mermaid sequence diagrams for the important flows.

> Generated from `apps/api/src/routes` on 2026-08-25. All paths are served under the `/api` base path.

## Architecture at a glance

The API is a [Hono](https://hono.dev) app. Every request passes through a fixed middleware pipeline, then a route handler, then a service that talks to the per-tenant PostgreSQL schema and/or NATS.

```mermaid
sequenceDiagram
    participant C as Client
    participant A as API (Hono)
    participant M as Middleware
    participant H as Route handler
    participant S as Service
    participant D as Postgres (tenantDb)
    participant N as NATS
    participant R as Centrifugo
    C->>A: HTTP /api/...
    A->>M: CORS -> global rate limit
    M->>M: authMiddleware (JWT + session)
    M->>M: tenantMiddleware (X-Company-ID -> role/permissions/tenantDb)
    M->>M: permission/role/visibility guards
    M->>H: route handler
    H->>S: service call
    alt synchronous read/write
        S->>D: tenant schema query
        S-->>H: result
    else async WhatsApp action
        S->>D: persist + enqueue command
        S->>N: publish command (outbox)
        N-->>R: later: events -> broadcast
    end
    H-->>A: response
    A-->>C: JSON

```

### Request context

- **Auth:** `Authorization: Bearer <access-token>` (JWT). Refresh tokens live in an HTTP-only cookie.
- **Tenant:** `X-Company-ID: <workspace-uuid>`. The tenant middleware resolves membership, role, permissions, and opens the per-tenant `tenant_<uuid>` schema connection.
- **Permissions:** feature-based (`can_send_messages`, `can_manage_connections`, ...) plus role hierarchy (owner > admin > member).

### Async command path

WhatsApp-affecting actions are asynchronous and reliable: the handler persists state and enqueues a command in the **command outbox**, which publishes to **NATS (JetStream)**. The **orchestrator** runs the **WhatsApp worker**, which performs the action against WhatsApp and publishes events back; the API consumes those events, persists the result, and broadcasts to **Centrifugo** for the realtime UI.

## Groups

| Group | File | Endpoints |
|-------|------|-----------|
| Auth | [`auth.md`](auth.md) | 14 |
| Companies (Workspaces) | [`companies.md`](companies.md) | 22 |
| Invitations (token acceptance) | [`invitations.md`](invitations.md) | 2 |
| Contacts | [`contacts.md`](contacts.md) | 20 |
| Conversations | [`conversations.md`](conversations.md) | 14 |
| Messages | [`messages.md`](messages.md) | 15 |
| Groups | [`groups.md`](groups.md) | 19 |
| WhatsApp Connections & Status | [`whatsapp.md`](whatsapp.md) | 20 |
| Notifications | [`notifications.md`](notifications.md) | 15 |
| Analytics | [`analytics.md`](analytics.md) | 13 |
| Bulk Broadcast Jobs | [`bulk-jobs.md`](bulk-jobs.md) | 7 |
| Catalogs | [`catalogs.md`](catalogs.md) | 9 |
| Labels | [`labels.md`](labels.md) | 10 |
| Tags | [`tags.md`](tags.md) | 4 |
| Quick Replies | [`quick-replies.md`](quick-replies.md) | 6 |
| Search | [`search.md`](search.md) | 5 |
| Status (Stories) | [`status.md`](status.md) | 6 |
| Audit | [`audit.md`](audit.md) | 4 |
| Export | [`export.md`](export.md) | 5 |
| Media | [`media.md`](media.md) | 3 |
| Actions (realtime REST) | [`actions.md`](actions.md) | 3 |
| Realtime (Centrifugo token) | [`realtime.md`](realtime.md) | 1 |
| Health | [`health.md`](health.md) | 3 |
| Feedback | [`feedback.md`](feedback.md) | 1 |
| Debug (NATS) | [`debug.md`](debug.md) | 5 |
| Root (`/`) | see below | 1 |

## Root

| Method | Path | Access | Description |
|--------|------|--------|-------------|
| GET | `/` | — | API service info (name and version) |
