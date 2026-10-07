# WATeamInbox Technical Overview

WATeamInbox is a multi-tenant collaborative omnichannel inbox. Teams can manage WhatsApp linked-device and Telegram Bot conversations today through one set of contacts, assignments, notes, notifications, audit logs, and analytics. Additional providers are expected to join through the same channel-neutral boundary rather than by expanding WhatsApp-specific models.

## Architecture

```text
React 19 + Vite
    | authenticated REST                    | Centrifugo WebSocket
    v                                       v
Hono API on Bun + channel-neutral spine --> Centrifugo
    | Kysely             | adapter contract        | NATS JetStream
    v                    v                         v
PostgreSQL       Telegram Bot adapter       Go orchestrator
    |                    |                         |
    +-> tenant schemas   +-> Telegram API          +-> WhatsApp worker -> WhatsApp

Supporting services: Meilisearch, R2/MinIO, Resend or Cloudflare Email Service
```

The spine models channels, providers, channel accounts, customer endpoints, conversations, messages, attachments, and delivery outcomes separately. Provider adapters normalize ingress and advertise capabilities to the UI and outbound dispatcher. This keeps Telegram's Bot API semantics and linked-device WhatsApp's worker lifecycle out of generic inbox workflows.

WhatsApp Cloud API, email, Messenger, and Instagram are planned adapter families, not currently available integrations.

## Monorepo

| Path | Responsibility |
| --- | --- |
| `apps/web` | React inbox and administration UI |
| `apps/api` | Hono REST API, auth, channel ingress/dispatch, business services, NATS consumers, Centrifugo publishing |
| `packages/adapter-telegram` | Telegram Bot normalization, capabilities, and outbound transport |
| `packages/database` | Kysely types, clients, and migrations |
| `packages/shared` | Shared TypeScript types, including channel/provider contracts |
| `packages/ui` | Shared React primitives |
| `services/orchestrator` | Go linked-device worker lifecycle manager |
| `services/whatsapp` | Go/whatsmeow connection worker |
| `services/shared` | Shared Go configuration and NATS contracts |

## Multi-tenancy

Cross-tenant identity and membership data lives in PostgreSQL's `public` schema. Each company has a schema named from its UUID. Every tenant request:

1. Verifies the access token and active session.
2. Validates company membership, role, and permissions.
3. Uses a schema-qualified Kysely handle backed by one bounded shared pool.

Tenant schemas contain channel accounts, customer endpoints, conversations, contacts, messages, attachments, delivery state, reactions, groups, assignments, notes, audit logs, notifications, and provider-specific compatibility metadata.

## Authentication

- Access tokens are short-lived JWTs held in browser memory.
- Rotating refresh JWTs are stored in an HttpOnly, SameSite cookie.
- Only SHA-256 refresh-token hashes are stored in `user_sessions`.
- Access middleware checks that the referenced session remains active.
- Email verification and password reset use hashed, expiring, single-use `auth_tokens` rows.
- Unverified accounts cannot create or refresh sessions. Verification resends require the account password and are rate-limited.
- Password reset revokes all existing sessions. Changing the account email also revokes every session until the new address is verified.

Production startup validates database, JWT, and Centrifugo configuration.

## Realtime

The API publishes company-scoped events to `company:{companyId}`. `/api/realtime/token` verifies the user, active session, and company membership before issuing a short-lived JWT containing server-side company and user subscriptions.

PostgreSQL remains the source of truth. Centrifugo updates local caches or triggers refetches; it is not used as durable storage.

See [Realtime Architecture](realtime-flow.md).

## Channel providers

### Telegram Bot

Telegram ingress reaches an unguessable account route, verifies Telegram's webhook secret, and is normalized by `packages/adapter-telegram` before any tenant mutation. Bot tokens and webhook secrets are encrypted at rest. Outbound actions use leased, idempotency-aware intents; ambiguous provider outcomes are surfaced rather than blindly retried because Telegram does not provide a send idempotency key.

### WhatsApp linked device

The API sends linked-device commands through NATS. The orchestrator manages one isolated worker process per WhatsApp connection. Workers use whatsmeow, persist session state in PostgreSQL, upload media to S3-compatible storage, and publish events back through the durable channel bridge.

JetStream uses durable, explicitly acknowledged consumers for at-least-once delivery. API commands are first committed to a tenant-local transactional outbox and published with the outbox ID as the JetStream deduplication ID. Message, contact, and reaction constraints make redelivery safe.

## Sending messages

Conversation sends resolve the owning channel account and its provider capabilities before creating durable outbound state. Neutral providers use the channel outbound intent dispatcher; linked-device WhatsApp retains its transactional NATS outbox handoff. Every send, forward, and retry route requires `can_send_messages`, and no route may fall back to an arbitrary active account.

Legacy contact-ID routes remain as a compatibility façade while the application completes its channel-neutral transition. New provider work should use conversation and channel-account identities rather than WhatsApp JIDs or connection IDs.

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
| PostgreSQL | 4447 |
| NATS | 4448 |
| Meilisearch | 4449 |
| MinIO | 4450 |
| Centrifugo | 4451 |

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
- [Channel-neutral messaging spine (RFC)](channel-neutral-spine-rfc.md) — architecture and migration rationale
- [Channel-neutral spine operations](operations/channel-neutral-spine.md) — provider configuration, rollout controls, reconciliation, and rollback
