# Connection recovery notification release — 2026-10-22

Closes persistent WhatsApp outage notifications when the affected connection
recovers and gives workspace users a durable success notification. Previously,
the connection-status trigger deleted the pending email-alert row on recovery
but left its saved offline notification unread and created no corresponding
recovery event.

## Release

- OSS revision: `f476b0ffa1da3b1356a035461619c41493a030e8`
- Private control-plane revision: `693cd01f4932d71107550b104bd02aecb8a4ad2c`
- Immutable release alias: `f476b0f.693cd01`
- Database migration: `109_add_connection_recovery_notifications`

For an outage that lasted long enough to create a persistent notification, a
subsequent connected status now:

1. marks that incident's offline notification read;
2. inserts one `WhatsApp reconnected` system notification per recipient; and
3. removes the pending connection email-alert row.

An outage that self-heals before the five-minute grace period still produces no
notification. The recovery insert is tied to the existing
`notification_created_at` marker, so repeated connected events cannot create a
success notice for a short or already-resolved incident.

The web notification provider now invalidates notification queries when either
the WhatsApp connected event or the worker connected status event arrives. This
keeps the bell and Activity Inbox current without requiring a manual reload.

## Validation

Passed locally:

- focused connection-alert email unit tests: 3 passed;
- connection email-alert database integration tests: 12 passed;
- notification architecture tests: 16 passed;
- `bun run typecheck`;
- `bun run build`;
- targeted Biome checks; and
- `git diff --check`.

GitHub Actions run `39712457541` passed static analysis, TypeScript unit and
integration tests, and Go unit, race, and integration tests. Migration 109 also
completed successfully in CI. The security job, and therefore the aggregate
`validate` job, failed only on the repository's pre-existing Go 1.25 standard
library vulnerabilities; this release contains no Go or dependency changes.

## Backup

A fresh PostgreSQL custom-format dump was created immediately before the
migration. The compressed local archive was verified at 146,376,952 bytes and
the corresponding restic/R2 snapshot was verified current. The backup command
exited successfully.

## Pre-deployment image digests

| Container | Image digest |
| --- | --- |
| `api-17`, `api-18` | `sha256:9b8a649f27fba3657ea1d714bec0085b04bdc8232d4d2538a570c363e203f4be` |
| `web-1` | `sha256:5152ee55ea518cfebe231f9a6f888809391f84ac8620fb33dce7e7f517ab473f` |
| `orchestrator-1` | `sha256:dafe78fea56eeb3601dbae7693c6db7cd2bb9a37e629922c589785855f87af5e` |
| `cloud-control-1` | `sha256:190ad0ac432f575f25eb04230eb574f07b2c34c46c68a981b4e87a061b62a194` |

## Deployment

`deploy.sh --plan` exited successfully and built/tagged
`f476b0f.693cd01`, but its replacement set included the stop-first
orchestrator. The full apply was not run.

The plan listed:

- `wateaminbox-production-api-17`;
- `wateaminbox-production-api-18`;
- `wateaminbox-production-cloud-control-migrate-1`;
- `wateaminbox-production-migration-1`;
- `wateaminbox-production-orchestrator-1`;
- `wateaminbox-production-web-1`; and
- `wateaminbox-production-worker-artifact-installer-1`.

The already-built application migration image was run directly with the normal
production Compose overlays. It reported migration 109 successful. API and web
were then replaced without dependencies:

```sh
docker compose --env-file .env.production \
  -f /opt/wateaminbox/compose.production.yml \
  -f deploy/compose.production.override.yml \
  -f deploy/compose.database-capacity.yml \
  up -d --no-deps --wait api web
```

No orchestrator, worker, PostgreSQL, cloud-control, or proxy container was
replaced.

## Verification

- Migration 109 is recorded in `public.kysely_migration`.
- All 34 tenant schemas contain the new recovery trigger function.
- Both API replicas are healthy on
  `sha256:e8d78f8cde4b14799b94a7e91b6f2262da36cbab79ca7c64c6b76a8ccceb51a1`.
- Web is healthy on
  `sha256:5c7a9dbd7d94f1fc3d95fbad46bafb63e531a1b1cc0455964484af8af5ec5826`.
- The public application serves `assets/index-CD-u1qIl.js`; both `/` and
  `/api/health` returned HTTP 200.
- New API logs contained no error, fatal, panic, or migration failure.
- The orchestrator container identity and start time were unchanged.
- The investigated Growthguy Support connection and its active session remained
  connected after the release.

A read-only post-release inventory found three recent unread outage notices for
connections that had already recovered before migration 109, including one for
Growthguy Support. The owner declined a one-time data reconciliation, so those
historical rows were not changed. Future qualifying recoveries follow the new
lifecycle.

## Rollback

The prior API and web images remain pinned as `3807a67.693cd01`:

- API: `sha256:9b8a649f27fba3657ea1d714bec0085b04bdc8232d4d2538a570c363e203f4be`
- Web: `sha256:5152ee55ea518cfebe231f9a6f888809391f84ac8620fb33dce7e7f517ab473f`

Migration 109 is forward-only. Rolling the containers back does not remove its
trigger definition. The trigger remains compatible with the existing alert and
notification tables; do not attempt to reverse the migration during an
application rollback.
