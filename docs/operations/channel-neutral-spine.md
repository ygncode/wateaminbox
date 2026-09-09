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

Unmerge is not implemented. Correct a wrong merge by creating a new contact and
reassigning the affected endpoints, which leaves the original audit trail
intact.

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
- Contact merge has no unmerge path, and merge *suggestions* are not generated;
  merges are operator-initiated only.
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
