# Background command dispatch

Migration 084 adds three command-dispatch tables/functions (and, historically, a
durable message search queue). Apply it before updating the API. It is additive;
do not run its down migration while any API is writing commands.

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

Search is served directly by PostgreSQL (migration 110: pg_trgm indexes and a
`search_vector` trigger in every tenant schema). There is no external index and
no background search queue any more: the former Meilisearch projection and the
`public.message_search_outbox` dispatcher were removed. The outbox table itself
is dropped in a later migration once no API replica that still writes to it is
running.

## Rollout and rollback

1. Record running API image IDs, schema revision, worker launch fingerprints,
   and aggregate queue/database health. Take a recoverable database backup.
2. Build and validate the API and migration images before touching live services.
3. Apply migration 084 with a bounded lock wait. Leave workers, NATS, storage,
   PostgreSQL configuration and the commercial controller unchanged.
4. Replace API replicas one at a time, leaving a healthy replica serving users.
5. Verify readiness, command backlog, HTTP errors and
   database session headroom. Existing worker launches should remain unchanged.

If rollback is necessary, restore the previous API images but retain the
additive schema and triggers. Old APIs continue to scan all tenant outboxes.

Queue counts/oldest due timestamps in the command queue tables support operator
diagnosis without exposing message contents.
