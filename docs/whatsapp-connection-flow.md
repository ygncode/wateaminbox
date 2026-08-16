# WhatsApp Connection Flow

## Creating a connection

1. An admin posts to `/api/whatsapp/connections`.
2. The API validates tenant membership, role, and the company's connection limit.
3. A stable inbox identity is created in `whatsapp_connections`, together with
   a replaceable row in `whatsapp_connection_sessions`.
4. In the same transaction, the API writes a spawn command to the tenant
   command outbox. Worker commands and whatsmeow credentials use the session
   ID; contacts and messages use the stable connection/account ID.
5. The Go orchestrator starts a dedicated WhatsApp worker.
6. The worker initializes whatsmeow and requests a QR code.
7. QR and connection events travel from the worker through NATS to the API.
8. The API persists state changes and publishes them to the company's Centrifugo channel.
9. React connection hooks display the QR code and update connection state.

The create endpoint returns the connection record. Realtime events arrive through the authenticated Centrifugo connection.

## Channel security

`POST /api/realtime/token` verifies the access token, active session, and tenant membership before placing `company:{companyId}` in the short-lived Centrifugo connection token.

## Lifecycle states

```text
pending -> connecting -> connected
   |            |            |
   +---------- error <-------+
                |
          disconnected
```

The orchestrator persists non-secret worker metadata and handles process
lifecycle. Its durable consumer retains commands published while it is
offline. The API resolves every worker session event back to its stable account
before writing inbox data.

## Disconnect, archive, and deletion

- **Disconnect** stops the worker but retains the session credentials and stable
  account so reconnect can resume the same linked device.
- **Archive & unlink** logs the device out of WhatsApp, purges all rows in the
  `whatsapp_sessions` schema for that session, ends the session record, and
  hides the stable account. Contacts, messages, notes, and assignments remain.
- **Link again** creates a new pairing session for the archived stable account.
  The expected phone identity is enforced before the session can claim it.
- **Create and pair the same phone again** atomically moves the new session from
  its empty provisional account to the historical stable account. The
  provisional account is removed, preventing duplicate conversations.
- **Permanent deletion** is a separate permission-gated operation that only
  accepts archived accounts and erases their retained inbox data. A
  still-linked account is refused with 409, not deleted.

Archive/unlink commits the account state, ended session, and idempotent unlink
command together through the tenant outbox. The worker receives a dedicated
unlink signal, logs out from WhatsApp, purges its credential store, and exits.

Permanent deletion runs in one transaction ordered around the tenant schema's
foreign keys - conversation cases before the messages they were opened by,
messages before their contacts, the account row last. It erases the account's
contacts, messages, reactions, cases, conversation states, groups, tag links,
assignments, notes, contact notifications, undelivered schedules and bulk
leaves, status updates, labels, catalogs, products, bulk pacing budget, and
sessions. Search documents and private media objects are recorded as durable
cleanup work in the same transaction. Search cleanup is attempted immediately;
all unfinished work is retried by an independent maintenance cycle until
settled. Workspace-level records shared with other
connections (tags, bulk job parents, quick replies) and the audit trail are
kept, as is any queued unlink command still waiting for the worker. Aggregate
purged-recipient counters preserve retained bulk-job progress without retaining
contact-linked leaves.

### Stored-media ownership

An object is deleted only when no row anywhere in the tenant still points at
it - messages (attachment and sender avatar), contacts, status updates,
undispatched schedules, live broadcasts, and the workspace logo, which shares
the same `media/<companyId>/` key namespace. Object keys are per-upload unique
and immutable, so a new upload can never collide with one being reclaimed, and
every path that persists an existing key either copies it from a row the check
already reads or re-validates it with a HeadObject that fails once the object
is gone.

The remaining interleaving - a request that validated its object before the
check and commits its row after the delete - is closed by a shared ownership
protocol. Both sides serialize on a transaction-scoped advisory lock derived
from the canonical object key (never the reference spelling, since one object
has several valid spellings), taken in sorted key order so overlapping sets
cannot deadlock. No network call is made while a lock is held: writers validate
their upload before opening the transaction, and cleanup commits a deletion
intent (`purge_cleanup_items.media_key` plus a `deleting` marker) and releases
the lock before calling object storage. A writer that finds an intent for its
key refuses with 409 rather than persisting a row that points at an object
about to vanish, and the intent survives a failed retry so the key stays closed
until the deletion finishes. The participating writers are `messages/send`
(send, forward, retry), `messages/scheduled`, `conversations/messages`,
`bulk-jobs`, and `status`. An object still has to look unreferenced across two
checks a settle window apart before the intent is taken.

Reclaiming objects stranded by purges that ran *before* this queue existed is
**not** automatic and is deliberately not part of startup or the cleanup cycle.
It requires listing the tenant prefix, so it belongs in a separate, approved
maintenance operation with a dry run.

## Main files

| Area | File |
| --- | --- |
| Connection routes | `apps/api/src/routes/whatsapp/connections.ts` |
| Connection service | `apps/api/src/services/whatsapp/connection.ts` |
| Orchestrator manager | `services/orchestrator/internal/manager/manager.go` |
| Worker client | `services/whatsapp/internal/client/client.go` |
| API event handlers | `apps/api/src/services/handlers/connection-handlers.ts` |
| React connection hooks | `apps/web/src/hooks/whatsapp/` |
