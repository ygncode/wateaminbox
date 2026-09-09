# Channel-neutral spine operations

This branch adds additive channel-neutral schema, Telegram Bot as the first
non-linked-device provider, and fenced linked-device dual-write/cutover
primitives. It is **not** production-ready as a complete RFC implementation.
Do not deploy, enable workspace flags, or run backfill against customer data
without a separate explicit approval.

## What this branch may enable later

- Additive tenant tables and public ingress/fanout routes.
- Encrypted Telegram Bot credentials and verified webhook ingress.
- Idempotent normalized event application and leased outbound/media jobs.
- Independent workspace flags for dual-write, shadow, neutral reads, write
  authority, and per-provider enablement. Missing/malformed flags fail closed
  to legacy/off.

## Required gates before any workspace enablement

1. Apply migrations `090`–`100` with all flags off. Confirm legacy messaging.
2. Run `apps/api/src/scripts/reconcile-channel-spine-indexes.ts` for every
   tenant. Unique message/reaction/assignment/case/state indexes are **not**
   created by migration `092`; ingress, provisioning, and outbound dispatch
   fail closed until those indexes exist and are valid.
3. Set `CHANNEL_CREDENTIAL_ENCRYPTION_KEYS` and
   `CHANNEL_CREDENTIAL_ACTIVE_KEY_VERSION` before provisioning Telegram.
   Startup does not currently require them in every production process because
   linked-device-only hosts may not store provider secrets.
4. Deploy the same authority-aware API revision to every replica before
   dual-write or write-authority changes.
5. Enable flags in the RFC canary order: schema → dual-write/backfill →
   shadow → reads → linked-device write authority → one test Telegram account.

## Rollback

Flag-first only:

1. Disable new outbound admission and keep uncertain Telegram sends from
   retrying.
2. Keep ingress retryable if it cannot durably retain a verified event.
3. Return linked-device reads/writes to legacy only on an image that still
   understands accepted neutral rows.
4. Never drop additive tables, reuse idempotency keys, or delete provider IDs
   to force a resend.

Once a Telegram account has accepted traffic, turning flags off does not make
legacy WhatsApp code authoritative for that data.

## Legacy API deprecation window

Contact-id conversation routes remain supported as a compatibility façade.
New clients should prefer conversation UUIDs for assign, state, send, search
(`conversationId`), and merge. Do not remove contact-id routes in this
release. Retirement is a later maintenance change after a documented window.

## Contact merge (RFC phase 8)

Merge is implemented and gated. `POST /contacts/:id/merge` requires an admin or
owner role **and** a workspace whose channel-spine write authority is `neutral`
with a reconciled tenant schema; missing, invalid, or unreadable flags return
409 rather than merging against legacy contact-scoped workflow rows.

A merge moves `contact_endpoints` to the surviving contact, writes an immutable
`contact_merge_events` row plus per-endpoint reassignment audit rows, marks the
source `merged_into_contact_id`, refreshes the contacts search projection, and
leaves every conversation, message, assignment, case, state, note, and tag
exactly where it was.

Alias resolution is deliberately asymmetric:

- contact-profile reads follow `merged_into_contact_id` to the canonical row;
- conversation/workflow routes never follow merge aliases, so an old chat URL
  keeps resolving to its own conversation after its customer row was merged.

`GET /contacts/:id/merge-suggestions` (admin/owner) returns read-only candidate
evidence and is not behind the execution gate, so operators can review
candidates before a workspace is allowed to act on them. Candidates come only
from a shared normalized phone/email on person-like endpoints; names, avatars,
and usernames are never matched, and group/bot/shared endpoints are excluded on
both sides — a merge touching one is refused outright.

Unmerge is not implemented. Correct a wrong merge by creating a new contact and
reassigning the affected endpoints, which leaves the original audit trail
intact.

## Connecting a channel locally

Settings → Connections is channel-neutral. "Add connection" opens a provider
picker; WhatsApp continues into QR pairing, Telegram asks for a BotFather
token. A provider the workspace may not connect is shown disabled with the
server's own reason, from `GET /channel-accounts/providers`.

To connect a Telegram bot in a local workspace:

1. Set `CHANNEL_CREDENTIAL_ENCRYPTION_KEYS` and
   `CHANNEL_CREDENTIAL_ACTIVE_KEY_VERSION` for the API process. The keyring is
   `<version>:<32 bytes base64>` (`openssl rand -base64 32`) and the active
   version must name an entry in it. Both are blank in the checked-in example,
   and a provider that stores a secret reports itself unavailable until they
   are set.
2. Point `APP_URL` at a publicly reachable HTTPS origin. Telegram registers a
   webhook against it, so `localhost` cannot work — use a tunnel.
3. Enable the workspace flags:

   ```sh
   bun run apps/api/src/scripts/set-channel-spine-flags.ts \
     --company <workspace uuid> --dual-write --shadow --reads \
     --authority neutral --providers telegram_bot
   ```

4. Build the concurrent indexes, which provisioning fails closed without:

   ```sh
   bun run apps/api/src/scripts/reconcile-channel-spine-indexes.ts --apply
   ```

The flag script is an operator tool, not an API. Rollout order and approval
for anything beyond a local workspace are unchanged.

## Rolling a channel out to workspaces

Flags are per workspace and fail closed when absent, so a workspace with no
row stays on the legacy path. Nothing enables itself.

Set them with the shipped script rather than by hand; it advances the revision
the table's own trigger audits:

```sh
# One workspace, then watch it.
bun run apps/api/src/scripts/set-channel-spine-flags.ts \
  --company <uuid> --dual-write --shadow --reads \
  --authority neutral --providers telegram_bot

# Widen once it looks right. --dry-run prints what would change.
bun run apps/api/src/scripts/set-channel-spine-flags.ts \
  --all --dry-run --dual-write --shadow --reads \
  --authority neutral --providers telegram_bot
```

In a deployed image the script is at
`/app/apps/api/dist/scripts/set-channel-spine-flags.js` and must be run
through the secret entrypoint so it inherits `DATABASE_URL`:

```sh
docker exec <api-container> /usr/local/bin/secret-entrypoint \
  bun run /app/apps/api/dist/scripts/set-channel-spine-flags.js --all --dry-run ...
```

`--all` skips a workspace with no owner rather than aborting the run, because
the flag row records who made the change.

### New workspaces

`CHANNEL_SPINE_DEFAULT_PROVIDERS` names the providers a newly created
workspace starts with; `CHANNEL_SPINE_DEFAULT_REVISION` is recorded on the row
it writes. Empty means new workspaces begin on legacy, which is the default
and the right one for self-hosted deployments.

Seeding writes a real per-workspace row rather than making absence mean
"enabled", so the fail-closed rule still holds, every workspace remains
individually revocable, and the audit trail shows when each was enabled. A
seeding failure is logged and never blocks the signup that triggered it; that
workspace simply starts on legacy.

## Capability-driven UI

Neutral channel threads render inside `ChannelComposerGate`, which resolves the
account's adapter contract into composer switches and publishes them through
`ComposerFeaturesContext`. Text composition, attachments (and which attachment
kinds), scheduling, typing indicators, group mentions, and the text length
limit all come from that descriptor. Message actions are filtered the same way
through `MessageActionsProvider`: an action the adapter does not report is not
passed to the thread at all, so no menu entry can invoke it. Legacy
linked-device threads pass no descriptor and keep their existing behaviour.

## Continuous reconciliation

Dual write is best-effort: a shadow write that fails records a row in
`channel_spine_reconciliation_journal` and returns, so it can never abort the
legacy mutation that is still authoritative.

`channel-spine-reconciler.service.ts` runs in the API every five minutes and
converges the gap two ways:

- it drains the journal with exponential backoff, quarantining a row after
  eight failed attempts so a genuinely broken row cannot hide behind a
  permanently non-empty backlog;
- it sweeps legacy WhatsApp messages that still have no `conversation_id` and
  were never journaled at all - rows predating dual write, written by an old
  replica, or left by a writer that died between the two writes.

Rows are claimed with `FOR UPDATE SKIP LOCKED`, so running it on every API
replica divides the backlog rather than duplicating it.

An empty pending backlog is the signal that a workspace's legacy and neutral
data agree. Check it before widening any provider enablement:

```sql
SELECT count(*) FROM <tenant>.channel_spine_reconciliation_journal
WHERE status = 'pending';
```

Quarantined rows need explicit repair; they are not retried.

## Reviewing duplicates in the inbox

The contact profile shows a "Possible duplicates" section to owners and
admins, listing customers that share a normalized phone number or email with
the one on screen. Names and avatars are never matched, so a display-name
collision cannot produce a candidate.

Merging from there names the surviving customer explicitly and reports the
merge event id in the confirmation toast. That id is what the correction
endpoint below needs, and it is the only place it is shown.

## Correcting a merge

`POST /contacts/merges/:mergeEventId/unmerge` reverses one merge, behind the
same admin/owner and neutral-authority gate as merging. It restores the
endpoints that merge moved, revives the source customer, and leaves every
conversation, message, assignment, case, note, and tag exactly where it is -
none of them ever moved.

Only the merge currently in effect can be reversed. An endpoint that has since
been moved on by a later merge or a manual reassignment is skipped and counted
in `skippedEndpoints` rather than dragged back, so a newer decision is never
silently clobbered.

## Moving linked-device WhatsApp onto the spine

The order matters. Each step is verifiable and the last one is a flag flip
that reverses instantly.

### 1. Backfill

Neutral rows are created for new traffic by dual write, but history is not.
Run the checkpointed backfill; it is idempotent and resumable, so an
interrupted run is re-run rather than repaired.

```sh
docker exec <api-container> /usr/local/bin/secret-entrypoint \
  bun run /app/apps/api/dist/scripts/backfill-channel-spine.js --all --apply
```

`--all` skips workspaces that are not dual-writing rather than aborting.
Naming a workspace explicitly that is not enabled is still an error.

### 2. Prove parity before trusting it

Both must hold for every workspace before enabling the provider:

```sql
-- nothing left unmirrored
SELECT count(*) FROM <tenant>.messages
WHERE conversation_id IS NULL AND contact_id IS NOT NULL
  AND whatsapp_connection_id IS NOT NULL;

-- nothing stuck
SELECT status, count(*) FROM <tenant>.channel_spine_reconciliation_journal
GROUP BY status;
```

Then watch the API logs for `Linked-device normalization shadow mismatch`.
A non-zero rate means legacy and neutral disagree about live traffic, and the
provider must not be enabled until it is explained. This is RFC phase 4's exit
criterion and it is the whole point of the shadow.

### 3. Enable the provider

```sh
... set-channel-spine-flags.js --all --dual-write --shadow --reads \
  --authority neutral --providers telegram_bot,whatsapp_linked_device
```

Outbound WhatsApp sends now go through the linked-device adapter: the route
writes a message plus an outbound intent atomically, and the dispatcher claims
the intent and emits the same NATS command the legacy path always sent.
Inbound events deliberately stay on the legacy handler with dual write, which
produces the same neutral rows without moving the ingest path.

### 4. Rollback

Drop the provider from the list. Sends return to the legacy path on the next
request; nothing needs to be undone, because the neutral rows dual write
created are still correct and still maintained.

```sh
... set-channel-spine-flags.js --all --dual-write --shadow --reads \
  --authority neutral --providers telegram_bot
```

Intents already claimed finish on the adapter. Anything still pending is
retried by the dispatcher only while its provider is enabled, so pending
intents stop being claimed rather than failing.

## Known remaining work

Still incomplete before claiming the RFC finished:

- Assignment/cases/state `contact_id` is nullable (migration `098`) but most
  WhatsApp paths still dual-write a bridge contact. That dual-write is the
  intended transitional state; RFC phase 9 retires it.
- Database integration tests use `RUN_DB_INTEGRATION=1` against local Postgres
  (`localhost:4447` in docker-compose) and run with a 30s timeout, because
  building a tenant schema does not fit Bun's 5s default.
- Go lint/vet uses `vendor/whatsmeow` in this worktree.
- Phase 9 must not drop legacy WhatsApp columns in this branch.
- `repairNoGapRows` is not scoped to linked-device rows the way the backfill
  phases are, so a contact with no WhatsApp connection or no JID would be
  treated as an unrepairable blocked row and stop the sweep. No production
  workspace has such a contact today, which is why the fleet run is unaffected,
  but an imported contact could create one.

## Recovery notes

- Telegram webhook configure/disconnect is split across provider calls and
  database transactions. A failed activation or disconnect can leave a pending
  or disabled account; reconnect/retry the same bot instead of creating a
  second live account.
- Ambiguous Telegram send outcomes are `uncertain`, not retried.
- Provider redelivery with a new `receivedAt` is a duplicate, not a collision.

## Known CI flakes

Two failures show up on unrelated pull requests and are not regressions:

- `static` fails when the runner image's Google Chrome apt source serves a bad
  index. `apt-get update` fails as a whole when any source does, which took the
  ripgrep install and the entire job with it. The step now skips apt when
  ripgrep is already present and otherwise drops third-party sources by what
  they point at.
- `go-race` fails intermittently on
  `TestStop_CollectsEveryWorkerFailure`, where a healthy worker is reported as
  neither stopped nor removed. The stop refuses to signal a PID whose
  `/proc/<pid>/environ` does not identify the expected worker, which is real
  protection against signalling a reused PID; under `-race` on a loaded runner
  that check does not always resolve in time. Re-run it. Do not relax the
  check to make the test pass - it guards a process signal.
