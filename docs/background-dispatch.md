# Background command dispatch and message search

Migration 084 adds three command-dispatch tables/functions and a durable message
search queue. Apply it before updating the API. It is additive; do not run its
down migration while any API is writing commands or search jobs.

## Command dispatch

Each tenant outbox has a trigger that transactionally marks its workspace ready
in `public.outbox_dispatch_ready`. The schema identifies the workspace; command
payloads cannot choose another tenant. This covers old API writers during a
rolling deployment, scheduled sends, and future callers of the existing enqueue
helper. New-tenant reconciliation installs the same trigger.

Replicas claim ready workspaces using `SKIP LOCKED` and a two-minute lease. Each
turn publishes at most 25 commands and returns the workspace behind older ready
work. The existing command leases, stable NATS message IDs, retry backoff and
claim fencing remain authoritative. Expired workspace claims are recoverable;
they do not override command claims. Delivery is at-least-once, not exactly-once.

Completion reads the marker generation before measuring remaining work. Every
concurrent outbox write increments that generation. A changed generation keeps
the workspace ready even if the dispatcher measured an empty outbox. A unique
claim token prevents an old dispatcher clearing a replacement's claim.

A coordinated recovery scan visits up to ten active workspaces per minute,
advancing a durable cursor. Readiness backlog checks visit only marked
workspaces; idle tenants no longer add a query per health check. Both queue
polling and recovery use PostgreSQL time, not replica clocks.

## Message search

The incoming-message transaction saves an ID-only search job alongside the
message. Events and realtime broadcasts no longer wait for Meilisearch. The
background dispatcher reads current message/contact data and submits up to 25
documents belonging to one WhatsApp connection. Successful indexing removes
the jobs; failures back off and retry without a terminal retry limit.

Deletion ordering is intentionally preserved. The background transaction holds
the existing connection `FOR KEY SHARE` protection until task completion;
archive/purge takes an incompatible lock. Thus purge deletion is submitted
after indexing, or the dispatcher sees the archived/missing connection and
skips indexing. Simply moving the HTTP call outside this protection would allow
purged documents to be resurrected by a delayed indexing request.

The search dispatcher has a **separate pool capped at one PostgreSQL connection
per API replica**. Search latency therefore cannot consume HTTP/event pool slots.
Meilisearch HTTP requests and background task polling have five-second timeouts.
Timeouts leave durable work to retry; submitted tasks may still complete, so
document IDs remain stable and repeated submissions are idempotent.

Account for the extra connection in capacity planning:

`API replicas × (public pool + tenant pool + 1 search) + worker pools + orchestrator pools + other services + reserve`

This bounds background database usage; it does not claim that search never holds
a database connection or that a larger connection ceiling increases throughput.

## Rollout and rollback

1. Record running API image IDs, schema revision, worker launch fingerprints,
   and aggregate queue/database health. Take a recoverable database backup.
2. Build and validate the API and migration images before touching live services.
3. Apply migration 084 with a bounded lock wait. Leave workers, NATS, storage,
   PostgreSQL configuration and the commercial controller unchanged.
4. Replace API replicas one at a time, leaving a healthy replica serving users.
5. Verify readiness, command backlog, search queue age/attempts, HTTP errors and
   database session headroom. Existing worker launches should remain unchanged.

If rollback is necessary, restore the previous API images but retain the
additive schema and triggers. Old APIs continue to scan all tenant outboxes.
Outstanding search jobs require a healthy new-version background dispatcher to
drain; do not discard them or claim rollback is complete while they are stranded.
Drain them before a planned rollback, or repair and run the new dispatcher as a
separate supervised process while the old API serves requests.

`/api/health/ready` reports `messageSearch` loop progress and failure totals.
Queue counts/oldest due timestamps in the two public queue tables support
operator diagnosis without exposing message contents. A search outage should
not remove otherwise healthy messaging API replicas from the load balancer.
