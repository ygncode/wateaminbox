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

1. Apply migrations `090`–`097` with all flags off. Confirm legacy messaging.
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

## Known remaining work

Still incomplete before claiming the RFC finished:

- Assignment/cases/SLA rows still have NOT NULL contact_id; conversation_id is
  dual-written and uniquely indexed when present.
- Database integration tests require `RUN_DB_INTEGRATION=1` and PostgreSQL.
- Docker/Go worker validation is blocked until the daemon and vendored
  `whatsmeow` are available.
- Phase 9 must not drop legacy WhatsApp columns in this branch.

## Recovery notes

- Telegram webhook configure/disconnect is split across provider calls and
  database transactions. A failed activation or disconnect can leave a pending
  or disabled account; reconnect/retry the same bot instead of creating a
  second live account.
- Ambiguous Telegram send outcomes are `uncertain`, not retried.
- Provider redelivery with a new `receivedAt` is a duplicate, not a collision.
