# WATeamInbox Technical Overview

WATeamInbox is a multi-tenant collaborative WhatsApp inbox. Teams can manage connections, conversations, contacts, assignments, notes, labels, catalogs, notifications, audit logs, and analytics.

## Architecture

```text
React 19 + Vite
    | authenticated REST                 Pusher private channels
    v                                             ^
Hono API on Bun ---------------------------------+
    | Kysely                 | NATS JetStream
    v                        v
PostgreSQL             Go orchestrator -> WhatsApp worker -> WhatsApp
    |
    +-> tenant schemas

Supporting services: Meilisearch, R2/MinIO, Resend
```

## Monorepo

| Path | Responsibility |
| --- | --- |
| `apps/web` | React inbox and administration UI |
| `apps/api` | Hono REST API, auth, business services, NATS consumers, Pusher publishing |
| `apps/marketing` | Astro marketing and documentation site |
| `packages/database` | Kysely types, clients, and migrations |
| `packages/shared` | Shared TypeScript types and utilities |
| `packages/ui` | Shared React primitives |
| `services/orchestrator` | Go worker lifecycle manager |
| `services/whatsapp` | Go/whatsmeow connection worker |
| `services/shared` | Shared Go configuration and NATS contracts |

## Multi-tenancy

Cross-tenant identity and membership data lives in PostgreSQL's `public` schema. Each company has a schema named from its UUID. Every tenant request:

1. Verifies the access token and active session.
2. Validates company membership, role, and permissions.
3. Uses a schema-qualified Kysely handle backed by one bounded shared pool.

Tenant schemas contain contacts, messages, reactions, groups, connection state, assignments, notes, audit logs, notifications, and WhatsApp metadata.

## Authentication

- Access tokens are short-lived JWTs held in browser memory.
- Rotating refresh JWTs are stored in an HttpOnly, SameSite cookie.
- Only SHA-256 refresh-token hashes are stored in `user_sessions`.
- Access middleware checks that the referenced session remains active.
- Email verification and password reset use hashed, expiring, single-use `auth_tokens` rows.
- Password reset revokes all existing sessions.

Production startup validates database, JWT, and Pusher configuration.

## Realtime

The API publishes company-scoped events to `private-company-{companyId}`. `/api/pusher/auth` verifies the user, active session, company membership, and channel name before authorizing a subscription.

PostgreSQL remains the source of truth. Pusher updates local caches or triggers refetches; it is not used as durable storage.

See [Realtime Architecture](realtime-flow.md).

## WhatsApp services

The API sends commands through NATS. The orchestrator manages one isolated worker process per WhatsApp connection. Workers use whatsmeow, persist session state in PostgreSQL, upload media to S3-compatible storage, and publish normalized events back to the API.

JetStream provides at-least-once delivery, so message and reaction constraints enforce idempotency.

## Local development

```bash
cp .env.example .env
docker compose up -d
bun install
bun run db:migrate
bun run dev
```

Default ports:

| Service | Port |
| --- | ---: |
| Web | 4444 |
| API | 4445 |
| Marketing | 4446 |
| PostgreSQL | 4447 |
| NATS | 4448 |
| Meilisearch | 4449 |
| MinIO | 4450 |

## Validation

```bash
bun run lint       # Biome plus gofmt/go vet
bun run typecheck  # Strict API and web TypeScript checks
bun run test       # Bun unit tests and all Go modules in short mode
bun run build      # Production builds for all workspaces
```

CI runs a frozen install followed by all three commands and a forced clean build.

## Related documentation

- [Realtime Architecture](realtime-flow.md)
- [WhatsApp Connection Flow](whatsapp-connection-flow.md)
- [WhatsApp Synchronization Flow](whatsapp-sync-flow.md)
- [Typing Indicator Flow](typing-indicator-flow.md)
