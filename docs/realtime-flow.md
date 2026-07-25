# Realtime Architecture

WATeamInbox uses self-hosted Centrifugo for server-to-browser realtime events. Centrifugo uses the existing NATS server as its horizontal PUB/SUB broker.

## Authentication and channel isolation

Every authenticated browser requests a short-lived connection JWT from:

```text
POST /api/realtime/token
```

The endpoint validates the access token, active session, `X-Company-ID`, and company membership. The API—not the browser—places these server-side subscriptions in the JWT:

```text
company:{companyId}
user:{companyId}:{userId}
```

Centrifugo verifies the JWT signature, audience, issuer, and expiry. The browser never receives the HMAC secret or Centrifugo API key.

## Event flow

```text
WhatsApp -> Go worker -> NATS JetStream -> Bun API -> PostgreSQL
                                                  -> Centrifugo HTTP API
                                                  -> NATS broker
                                                  -> Centrifugo WebSocket
                                                  -> React Query/Zustand
```

Client-originated actions use authenticated REST endpoints. The browser includes its Centrifugo client ID when an ephemeral event should be hidden from the originating connection. The API places that ID in the publication and the client transport filters it.

Durable WhatsApp commands are committed to a tenant-local transactional outbox in the same transaction as application state. Typing and read-state actions remain ephemeral.

## Main files

| Responsibility | File |
| --- | --- |
| Server publisher and token signer | `apps/api/src/lib/realtime.ts` |
| Connection token endpoint | `apps/api/src/routes/realtime/index.ts` |
| REST realtime actions | `apps/api/src/routes/actions/index.ts` |
| Browser Centrifugo client | `apps/web/src/lib/realtime.ts` |
| React provider and cache updates | `apps/web/src/contexts/RealtimeProvider.tsx` |
| Centrifugo configuration | `infrastructure/centrifugo/config.json` |
| Shared payload types | `packages/shared/src/websocket-types.ts` |

The shared type filename is retained for API compatibility; it describes realtime event payloads rather than a transport implementation.

## Reliability

Realtime delivery is an invalidation/update signal, not the sole source of truth. The NATS broker path is at-most-once and does not provide Centrifugo history or recovery. Clients reconcile PostgreSQL-backed state after reconnecting and while long-running synchronization overlays are active.

The API consumes WhatsApp events through the durable `whatsapp-api-events-v1` JetStream consumer. It acknowledges only successful handlers and negatively acknowledges failures for redelivery.

## Production deployment

- Expose only the Centrifugo WebSocket endpoint publicly through TLS (`wss://`).
- Keep `/api`, `/metrics`, and `/health` private or protected by ingress rules.
- Give `CENTRIFUGO_API_KEY` and `CENTRIFUGO_TOKEN_HMAC_SECRET` independent random values.
- Configure `client.allowed_origins` for the production web origin.
- Run multiple Centrifugo nodes behind a WebSocket-capable load balancer when high availability is required; the NATS broker distributes publications between nodes.
- Monitor Centrifugo metrics and API readiness.
