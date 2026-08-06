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

### Which channel carries which event

Every member of a workspace is subscribed to `company:{companyId}`, so anything
published there is readable by the whole workspace. Events whose payload
carries conversation content must therefore be addressed to individual users.

| Channel | Contents |
| --- | --- |
| `company:{companyId}` | Workspace and connection control only: `qr`, `connected`, `disconnected`, `connection:status`, `sync:*`, `history:loaded`, `labels:updated`, `catalogs:updated`, `bulk_job:updated`, `command:failed`, `notification:toast`, `status`. |
| `user:{companyId}:{userId}` | `notification:new`, plus every conversation-scoped event: `message:new`, `message:status`, `message:deleted`, `message:reaction`, `message:failed`, `scheduled_message:updated`, `media:downloaded`, `media:download_failed`, `conversation:updated`, `conversation:read`, `contact:updated`, `contact:profile_picture`, `presence:*`, `typing:*`. |

Conversation-scoped events are fanned out by
`apps/api/src/services/message-broadcast.service.ts` to exactly the users
allowed to read that conversation over HTTP: members with `can_view_all_chats`
plus the contact's current active assignee. That predicate is the same one
`requireContactVisibility` enforces on the REST routes, so a member who would
receive a 404 from `GET /contacts/:id` learns nothing about that conversation
over realtime either — not its message bodies, and not the metadata that would
reveal it exists and is active.

Producers call `broadcastToContactViewers` (contact ID) or
`broadcastToContactViewersByJid` (WhatsApp JID, for worker events that only
carry one). The classification is enforced two ways: `ConversationRealtimeEventType`
is deliberately absent from `CompanyRealtimeEventType`, so publishing one
company-wide is a type error, and `apps/api/src/lib/realtime-channel-policy.test.ts`
pins the split itself.

Assignment changes pass `alsoNotifyUserIds` so the *outgoing* assignee is told
the conversation left them — the viewer resolver only sees the new state and
would otherwise leave their client showing a conversation it can no longer open.

Fan-out is a single Centrifugo `broadcast` call listing every recipient
channel, so audience size costs no extra round trips. Recipient channels are
deduplicated before the call: a repeated channel would deliver the event twice
and clients would apply it twice. An empty audience short-circuits, because
Centrifugo rejects an empty `channels` array outright (code 107).

### Fan-out cost and staleness

Resolving recipients needs two facts: workspace membership, and the contact's
current assignee. Typing and presence fire far more often than either changes,
so:

- **Membership is cached** (`REALTIME_MEMBERSHIP_CACHE_TTL_MS`, default 5000).
  Every write to `company_members` — role change, permission edit, removal,
  invitation acceptance, ownership transfer, workspace creation — calls
  `invalidateCompanyMembership`, so a revocation applies to the very next
  event. The TTL is a backstop, not the correctness mechanism. A read already
  in flight when a write lands cannot repopulate the cache behind it.
- **Assignments are never cached.** They are the per-conversation half of the
  authorization decision and change constantly, so they are read live on every
  event.
- **Repeat ephemeral signals are collapsed**
  (`REALTIME_EPHEMERAL_MIN_INTERVAL_MS`, default 1500). Only an *identical*
  state for the same conversation inside the interval is dropped; a state
  change always publishes, so a `typing:stop` can never be suppressed by a
  preceding `typing:start` and an indicator cannot get stuck on.

Multi-replica caveat: invalidation is in-process, like the in-memory rate
limiter. A second API replica keeps its own cached membership until its TTL
lapses, so a revocation can lag there by up to the TTL. Set the TTL to `0` to
read membership live on every event.

### Policy: `status` stays workspace-wide

`status` (WhatsApp Status/Stories) is deliberately **not** treated as a
conversation-scoped event, even though its payload is derived from a contact.

A Status post is broadcast by its author to their whole audience; it is not a
message in a one-to-one or group conversation. The workspace's visibility model
grants access per *contact assignment*, and a Status has no conversation and no
assignee to key that decision on — `status_updates` rows carry `from_jid` and a
connection, not a `contact_id`. Scoping it to "viewers of the contact with a
matching JID" would be inventing a rule the product does not otherwise have,
and would silently hide Statuses from operators who are expected to see them.

The trade-off is explicit: every workspace member can see that a given number
posted a Status, and its caption/media availability, regardless of whether they
are assigned that contact's conversation. Revisit this if Status ever gains an
assignment or ownership model of its own.

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

Realtime delivery is an invalidation/update signal, not the sole source of
truth. The NATS broker path is at-most-once and does not provide Centrifugo
history or recovery. Clients reconcile PostgreSQL-backed state after
reconnecting, every 60 seconds while connected, and while long-running
synchronization overlays are active.

The API consumes WhatsApp events through the durable `whatsapp-api-events-v1` JetStream consumer. It acknowledges only successful handlers and negatively acknowledges failures for redelivery.

## Production deployment

- Expose only the Centrifugo WebSocket endpoint publicly through TLS (`wss://`).
- Keep `/api`, `/metrics`, and `/health` private or protected by ingress rules.
- Give `CENTRIFUGO_API_KEY` and `CENTRIFUGO_TOKEN_HMAC_SECRET` independent random values.
- Configure `client.allowed_origins` for the production web origin.
- Run multiple Centrifugo nodes behind a WebSocket-capable load balancer when high availability is required; the NATS broker distributes publications between nodes.
- Monitor Centrifugo metrics and API readiness.
