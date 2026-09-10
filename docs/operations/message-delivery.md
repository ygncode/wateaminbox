# Message delivery and history application

One active WhatsApp worker owns each saved session. Additional connections can
use additional workers. Running two active workers against the same saved session
is not a throughput strategy. These are generic single-host runtime guarantees;
commercial fleet scheduling and hosted operations remain private.

## Outgoing commands

The API saves the pending message and command in one transaction. Recipient-scoped
transaction locks establish acceptance order across API replicas. Dispatchers
publish only the earliest unpublished command for each recipient/session; a
publication failure holds that recipient while other recipients proceed. The
partial recipient index applies to existing and newly created tenants.

The worker admits at most eight commands and pulls them individually. Every
admitted command renews its NATS acknowledgment deadline every 20 seconds,
including time spent waiting for media or for the sender. Database/transport
failures retain the contact's head locally instead of consuming broker delivery
attempts. Shutdown cancels and joins processing before closing the connection.

Ready contact heads are selected in round-robin order. Up to two media heads
prepare concurrently; each slot is held until its prepared data is consumed.
Downloaded input buffers are therefore bounded by two times the existing 50 MiB
per-file cap, excluding SDK/encryption overhead. A later message to that contact
cannot pass its media head. Fairness is bounded by the eight-command admission
window; this is not an unlimited queue in process memory.

The WhatsApp transport remains serialized. Network acceptance, WhatsApp media
uploads, and some control commands can still delay the sender. This change moves
object-storage downloads/validation off that path; it does not promise parallel
WhatsApp delivery through one account.

Before the WhatsApp transport is called, the worker atomically claims a durable
send intent. Its stable message ID is derived from company, session, and command
identity. A claim already present is never executed again. Successful sends
finalize that intent before confirmation; replay republishes the stored result.
The existing album manifest retains its own stable ID.

Preparation failures may retry (at most three attempts). NATS redelivery count is
not an application send-attempt count. Once the transport is invoked, an error or
an interrupted intent is treated conservatively as an unknown outcome. The
worker does not automatically send again. The inbox displays “Delivery
unconfirmed”; a receipt can still settle the message by its durable ID. Check the
conversation before deliberately sending another message. A crash between the
intent commit and transport invocation can also produce this state even if
nothing was sent: avoiding duplicates trades automatic liveness for certainty.

## History completion

Migration 086 adds ordering and broker-delivery state to the worker event outbox.
New worker events carry the durable outbox event ID. History messages/contacts
remain in the outbox after publication until the API has applied them. Completion
and on-demand-page markers wait for all earlier history rows in that session.
Thus the browser's final refresh happens after application, not merely publication.

A marker arriving early is acknowledged to NATS but stays in PostgreSQL. A
one-second API drain recovers eligible markers across process restarts, without
blocking the live consumer or spending NATS retry attempts. Historical handlers
remain idempotent for replay after application but before outbox deletion.
Legacy events without an event ID keep their old broker-delivery retention.

A permanently failed/dead-lettered history event keeps its marker blocked. Repair
and replay that event; do not delete its row just to make the sync indicator
finish. Unsupported message formats and WhatsApp's existing idle-completion
fallback remain outside this application-ordering guarantee.

## Rollout and rollback

Apply migration 086, deploy the API/web changes, then replace workers. Drain
outstanding old-worker send commands before replacing those workers: old attempts
have no write-ahead intent. Keep one active owner during replacement. Production
deployment is a separate approved operation.

Do not roll the API back while new workers emit retained history events or
uncertain outcomes. For a coordinated rollback, stop/drain new workers, let the
new API apply retained history and settle pending events, then restore the previous
application versions. Leave the additive columns in place until those queues are
empty. Never remove send intents to force automatic retries.

## Verification and observations

Worker command-completion logs report queue waiting time, execution time, and
admitted pending count without message content. Observe those separately from API
outbox backlog and retained history rows. A growing queue with high execution time
points at transport/control work; high preparation wait points at storage or the
bounded preparation pool. More workers help across different connections, not by
sharing one session.

Regression coverage includes ambiguous acceptance, restart after intent, stable
identity scope, acknowledgment renewal, slow media beside another contact's text,
per-contact ordering, preparation limits, cross-dispatcher publication failure,
late receipts, restricted worker-role persistence, and out-of-order history
application. Set TEST_NATS_URL and TEST_DATABASE_URL for the Go integration tests;
use only disposable local services. TypeScript integration tests use the existing
RUN_DB_INTEGRATION and DATABASE_URL configuration.

## Incoming persistence and user delivery

Workers use synchronous WhatsApp acknowledgements and the success-status event
handler. A failed message/reaction/revoke publication withholds acknowledgement.
The decrypted event buffer retains plaintext for redelivery; its write and Signal
ratchet updates commit in the same PostgreSQL transaction. Cleanup removes only
completed buffer entries, never unprocessed plaintext. A restart still relies on
WhatsApp redelivery of the unacknowledged stanza; this does not recover messages
lost before this version was installed.

Migration 089 adds `public.message_delivery_outbox`. Live message inserts enqueue
realtime delivery and, for incoming messages, push delivery in the same transaction
as unread counts and case changes. History imports do not enqueue user delivery.
Auto-unassignment audit entries also commit with the message.

Independent realtime and push pollers retry failed work with bounded backoff,
using row locks to prevent concurrent claims. Each poller processes one job at a
time. A push request times out after ten seconds; a slow push provider does not
block realtime polling. Recipients are resolved from current authorization on
every attempt. Archived connections and deleted messages are skipped. Jobs retain
identifiers and case transitions, not copies of message content or media keys.

Delivery is at least once: a crash after the external service accepts an update
but before the job commits can replay it. Realtime uses the stored message UUID
(the browser deduplicates it), and push retries retain the same notification tag.
A partially successful push batch can notify a successful endpoint again. A
successful provider response does not prove a device displayed the notification.

For backlog inspection, query only counts and timing:

```sql
SELECT kind, count(*), min(created_at) AS oldest, max(attempts) AS retries
FROM public.message_delivery_outbox GROUP BY kind;
```

Apply migration 089 before starting the updated API. Leave the table intact on
rollback; a previous API will not drain it. Resume an updated API to finish
pending work. No backfill is attempted for messages predating the migration,
because their prior notification delivery cannot be determined reliably.

The immediate-send and scheduled-message endpoints reject quotes to temporary
or unconfirmed outgoing stanzas with HTTP 400. Retry the reply after the
original message is confirmed; a rejected reply creates no pending message, no
scheduled row, and no command.
