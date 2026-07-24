# Realtime Architecture

WATeamInbox uses Pusher private channels for server-to-client events. The former Bun/Hono WebSocket server and browser WebSocket client have been removed.

## Channel isolation

Each company has one private channel:

```text
private-company-{companyId}
```

The browser authorizes a subscription through `POST /api/pusher/auth`. The endpoint requires:

- A valid access token
- An active user session
- `X-Company-ID`
- Membership in the requested company
- A channel name matching that company

Pusher credentials are supplied through environment variables. The secret is server-only.

## Event flow

```text
WhatsApp -> Go worker -> NATS JetStream -> Bun API -> PostgreSQL
                                                  -> Pusher private channel
                                                  -> React Query/Zustand
```

Client-originated actions use authenticated REST endpoints. Durable WhatsApp commands are committed to a tenant-local transactional outbox in the same transaction as application state. Typing and read-state actions remain ephemeral.

## Main files

| Responsibility | File |
| --- | --- |
| Server Pusher client | `apps/api/src/lib/pusher.ts` |
| Channel authorization | `apps/api/src/routes/pusher/auth.ts` |
| REST realtime actions | `apps/api/src/routes/actions/index.ts` |
| Browser Pusher client | `apps/web/src/lib/pusher.ts` |
| React provider and cache updates | `apps/web/src/contexts/PusherProvider.tsx` |
| Shared payload types | `packages/shared/src/websocket-types.ts` |

The shared type filename is retained for API compatibility; it describes realtime event payloads rather than a transport implementation.

## Reliability

Pusher delivery is used as an invalidation/update signal, not the sole source of truth. The API consumes WhatsApp events through the shared `whatsapp-api-events-v1` durable queue consumer and explicitly acknowledges only successful handlers. Failed handlers are negatively acknowledged for redelivery. Clients invalidate or update React Query caches and can refetch after reconnecting.
