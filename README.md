# wateaminbox

A multi-user WhatsApp team inbox for managing customer conversations, assignments, contacts, groups, and team workflows from one web application.

## Features

- Multi-account WhatsApp connectivity powered by whatsmeow
- Shared realtime inbox with message status, reactions, media, presence, and typing indicators
- Contact assignment and role-based conversation visibility
- Contact profiles, notes, tags, labels, and bulk import/export
- Groups, quick replies, search, analytics, audit logs, and team management
- In-app notification center, desktop notifications, realtime toasts, and optional Web Push
- Tenant-isolated PostgreSQL schemas
- Durable commands and events through NATS JetStream

## Architecture

```text
┌──────────────────┐       HTTP/Pusher       ┌──────────────────┐
│ React web app    │◀───────────────────────▶│ Hono API (Bun)   │
└──────────────────┘                         └────────┬─────────┘
                                                    │
                                      PostgreSQL / NATS JetStream
                                                    │
                                            ┌───────▼────────┐
                                            │ Go orchestrator │
                                            └───────┬────────┘
                                                    │ manages
                                            ┌───────▼────────┐
                                            │ WhatsApp worker │
                                            │   (whatsmeow)   │
                                            └────────────────┘
```

### Repository layout

| Path | Purpose |
| --- | --- |
| `apps/web` | React 19, Vite, Tailwind CSS, TanStack Query |
| `apps/api` | Hono API running on Bun |
| `apps/marketing` | Astro marketing site |
| `packages/database` | Kysely database client and migrations |
| `packages/shared` | Shared TypeScript types and utilities |
| `packages/ui` | Shared React components |
| `services/orchestrator` | Go process manager for WhatsApp workers |
| `services/whatsapp` | Go WhatsApp worker using whatsmeow |
| `services/shared` | Shared Go packages |

## Prerequisites

- [Bun](https://bun.sh/) 1.2.18 or newer
- [Go](https://go.dev/) 1.25 or newer
- [Docker](https://www.docker.com/) with Docker Compose
- A [Pusher Channels](https://pusher.com/channels) application for realtime communication
- Optional: a [Resend](https://resend.com/) API key for transactional email

## Local development

### 1. Install dependencies

```bash
bun install
```

Go dependencies are downloaded automatically by Go when the services build.

### 2. Configure environment variables

Create the root environment file:

```bash
cp .env.example .env
```

At minimum, replace `JWT_SECRET` with a random value of at least 32 characters and configure Pusher:

```env
JWT_SECRET=replace-with-a-random-secret-at-least-32-characters

PUSHER_APP_ID=your-app-id
PUSHER_KEY=your-key
PUSHER_SECRET=your-secret
PUSHER_CLUSTER=ap1

VITE_PUSHER_KEY=your-key
VITE_PUSHER_CLUSTER=ap1
```

The browser key is public; the Pusher secret must only be available to the API.

Bun loads the root `.env` when commands are run from the repository root. If you run an app directly from its workspace directory, create an app-local ignored `.env` or export the required variables first. Common frontend values are:

```env
VITE_API_URL=http://localhost:4445/api
VITE_PUSHER_KEY=your-key
VITE_PUSHER_CLUSTER=ap1
```

### 3. Start infrastructure

```bash
docker compose up -d
```

This starts:

| Service | Address |
| --- | --- |
| PostgreSQL | `localhost:4447` |
| NATS | `localhost:4448` |
| NATS monitoring | <http://localhost:8222> |
| Meilisearch | <http://localhost:4449> |
| MinIO S3 API | <http://localhost:4450> |
| MinIO console | <http://localhost:9001> |

### 4. Run migrations

```bash
bun run db:migrate
```

Migrations create the central tables and tenant-isolated schemas.

### 5. Start the application

```bash
bun run dev
```

The main development endpoints are:

- Web app: <http://localhost:4444>
- API: <http://localhost:4445/api>
- API health: <http://localhost:4445/api/health>
- Orchestrator: <http://localhost:8080>
- Astro uses its default development port unless configured otherwise.

The root development command builds the WhatsApp worker before starting the orchestrator. The orchestrator then manages worker processes for active WhatsApp connections.

## Web Push notifications

Web Push is optional. Without it, desktop notifications work only while the application is loaded. Configure Web Push to receive notifications while the app is backgrounded or closed.

### Generate VAPID keys

Generate one stable key pair:

```bash
bunx web-push generate-vapid-keys --json
```

Configure the API with both keys:

```env
VAPID_PUBLIC_KEY=generated-public-key
VAPID_PRIVATE_KEY=generated-private-key
VAPID_SUBJECT=mailto:notifications@example.com
```

Expose only the same public key to the Vite build:

```env
VITE_VAPID_PUBLIC_KEY=generated-public-key
```

Never expose `VAPID_PRIVATE_KEY`, and do not regenerate the pair on every deployment. Changing keys invalidates existing browser subscriptions.

Restart the API and rebuild/restart the web app after changing these values. Web Push requires HTTPS in production; browsers allow `localhost` as a secure development context.

### Enable and verify

1. Sign in and open **Settings → Notifications**.
2. Enable desktop notifications and accept the browser permission prompt.
3. In Chrome or Edge DevTools, open **Application → Service Workers**.
4. Confirm `/notification-sw.js` is active.
5. Confirm these requests succeed in the Network panel:
   - `GET /api/notifications/push/status`
   - `POST /api/notifications/push/subscribe`
6. Close all application tabs and send an incoming WhatsApp message from another device.
7. Click the OS notification and verify that it opens the correct conversation.

The receiving user must be assigned to the contact or have permission to view all chats. Disabled notifications, quiet hours, and muted contacts suppress delivery.

## Useful commands

| Command | Description |
| --- | --- |
| `bun run dev` | Start workspace development processes |
| `bun run build` | Build all applications, packages, and services |
| `bun run lint` | Run TypeScript/Astro/Go lint checks |
| `bun run typecheck` | Type-check shared packages, API, and web app |
| `bun run format` | Format TypeScript workspace files with Biome |
| `bun run test` | Run API, web, and short Go tests |
| `bun run test:integration` | Run database and Go integration tests |
| `bun run check:unused` | Find unused files and dependencies with Knip |
| `bun run db:migrate` | Apply database migrations |
| `bun run db:generate` | Regenerate Kysely database types |
| `docker compose down` | Stop local infrastructure |

Integration tests require the local infrastructure and use:

```bash
RUN_DB_INTEGRATION=1 bun run test:integration
```

## Health checks

The API exposes:

- `GET /api/health` — overall service status
- `GET /api/health/live` — liveness probe
- `GET /api/health/ready` — PostgreSQL, NATS, event consumer, outbox, and Pusher readiness

A missing NATS connection or Pusher configuration reports degraded readiness, while PostgreSQL failure reports the service as unready.

## Troubleshooting

### Realtime events do not arrive

- Verify all Pusher server and browser values use the same application and cluster.
- Check `GET /api/health/ready` for Pusher and NATS status.
- Confirm the browser successfully authorizes and subscribes to its private company/user channels.

### Web Push does not arrive

- Check `GET /api/notifications/push/status`; `configured` and `subscribed` should both be `true`.
- Verify browser and operating-system notification permissions.
- Ensure the service worker is active and the application is served over HTTPS or `localhost`.
- Ensure the user can view the contact, is outside quiet hours, and has not muted it.
- Check API logs for `Web Push batch completed`. An `attempted` value of zero means no eligible recipient or stored subscription.

### Database state needs to be reset

The repository includes `scripts/clean-db.sh`. It is destructive; inspect it before running and never use it against a production database.

### NATS debugging

Use `scripts/debug-nats.sh`, or start the optional NATS toolbox:

```bash
docker compose --profile debug up -d nats-box
```

## Security notes

- Never commit `.env` files, JWT secrets, Pusher secrets, VAPID private keys, Resend keys, or production storage credentials.
- Keep `VITE_*` variables limited to values safe for browsers.
- Use HTTPS in production.
- Notification and conversation access is scoped by company membership, permissions, and tenant schema.

## Contributing

Before opening a pull request, run:

```bash
bun run lint
bun run typecheck
bun run test
bun run build
```

Run integration tests when changing database migrations, NATS behavior, the orchestrator, WhatsApp worker, or end-to-end messaging flows.
