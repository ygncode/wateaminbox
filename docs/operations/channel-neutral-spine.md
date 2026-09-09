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

## Known remaining work

Still incomplete before claiming the RFC finished:

- Assignment/cases/state `contact_id` is nullable (migration `098`) but most
  WhatsApp paths still dual-write a bridge contact. That dual-write is the
  intended transitional state; RFC phase 9 retires it.
- Contact merge has no unmerge path, and suggestions are never auto-applied;
  every merge is operator-initiated.
- Merge suggestions have no web UI; the endpoint is API-only.
- Database integration tests use `RUN_DB_INTEGRATION=1` against local Postgres
  (`localhost:4447` in docker-compose).
- Go lint/vet uses `vendor/whatsmeow` in this worktree.
- Phase 9 must not drop legacy WhatsApp columns in this branch.

## Recovery notes

- Telegram webhook configure/disconnect is split across provider calls and
  database transactions. A failed activation or disconnect can leave a pending
  or disabled account; reconnect/retry the same bot instead of creating a
  second live account.
- Ambiguous Telegram send outcomes are `uncertain`, not retried.
- Provider redelivery with a new `receivedAt` is a duplicate, not a collision.
