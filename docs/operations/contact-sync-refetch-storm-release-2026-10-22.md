# Contact-sync refetch storm release — 2026-10-22

Stops a large WhatsApp history sync from turning one contact update into one
full inbox-list request per open browser query. The storm saturated both API
replicas and PostgreSQL, made `/api/contacts` take several seconds, caused the
API health checks to flap, and left `/api/auth/refresh` returning 503 whenever
HAProxy temporarily had no healthy backend.

## Release

- OSS revision: `3807a675513e07fc6e281963031899b558d69ad2`
- Private control-plane revision: `693cd01f4932d71107550b104bd02aecb8a4ad2c`
- Immutable release alias: `3807a67.693cd01`
- No database migration, API runtime change, worker change, or orchestrator
  change was included.

The trace found this feedback loop:

1. History sync applies each contact and emits `contact:updated`; contacts with
   avatar data can also emit `contact:profile_picture`.
2. The web handler invalidated every active inbox projection for every event.
3. TanStack Query's default invalidation behavior cancelled and replaced an
   in-flight request. Cancellation closed the client connection, but did not
   reliably stop work already running in the API and PostgreSQL.
4. Repeated expensive list queries consumed both API replicas until HAProxy's
   three-second readiness checks failed.

The web now batches contact metadata and avatar invalidations after 500 ms of
quiet, with a five-second maximum wait. Bounded flushes do not cancel an
already-running list request. `sync:complete` cancels the pending timer and
performs one authoritative final refresh. Message, read, and lifecycle events
remain immediate.

The regression test sends 1,000 contact events and asserts one list refresh,
then sends another burst and asserts that `sync:complete` performs exactly one
final refresh without a delayed duplicate.

## Incident evidence

Before the fix, a three-minute HAProxy sample contained about 1,600
`/api/contacts` requests. A later one-minute sample contained 722 contact-list
requests, including 339 HTTP 503 and 127 HTTP 502 responses. The host had a
load average around 15 on four CPUs, only a few hundred MiB available, and all
2 GiB of swap occupied. Both API backends repeatedly failed and recovered from
readiness checks.

## Validation

Passed locally:

- `bun test apps/web/src/contexts/realtime/event-handlers.test.ts`
- `bun run typecheck`
- `bun run build`
- targeted Biome checks
- `git diff --check`

GitHub Actions run `39709011110` passed static analysis, TypeScript unit and
integration tests, and Go unit, race, and integration tests. Its security job
failed on newly reported vulnerabilities in the repository's existing Go
1.25.13 standard library, fixed upstream in Go 1.26.9. This release contains no
Go or dependency changes. The aggregate `validate` job failed only because of
that security job.

## Pre-deployment image digests

| Container | Image digest |
| --- | --- |
| `api-17`, `api-18` | `sha256:9b8a649f27fba3657ea1d714bec0085b04bdc8232d4d2538a570c363e203f4be` |
| `web-1` | `sha256:4ebc09ffaba15f9bbee664df2132a0a95f45032223731e3b5028d7335663bbc7` |
| `orchestrator-1` | `sha256:dafe78fea56eeb3601dbae7693c6db7cd2bb9a37e629922c589785855f87af5e` |
| `cloud-control-1` | `sha256:190ad0ac432f575f25eb04230eb574f07b2c34c46c68a981b4e87a061b62a194` |

During the plan build, the already-overloaded `api-17` process exited and
restarted once without an OOM flag. Its image did not change. This happened
before the targeted deployment and is recorded separately from the web
replacement.

## Deployment

`deploy.sh --plan` exited successfully and built/tagged
`3807a67.693cd01`, but its replacement set included the stop-first
orchestrator because the production orchestrator still runs the older
source-equivalent pinned image documented in prior releases. The full apply was
not run.

The plan listed:

- `wateaminbox-production-cloud-control-migrate-1`
- `wateaminbox-production-orchestrator-1`
- `wateaminbox-production-web-1`
- `wateaminbox-production-worker-artifact-installer-1`

A targeted dry run listed only `web-1`. The already-built web image was then
applied without dependencies, migrations, pulls, or builds:

```sh
docker compose --env-file /opt/wateaminbox-cloud-control/.env.production \
  -f /opt/wateaminbox/compose.production.yml \
  -f /opt/wateaminbox-cloud-control/deploy/compose.production.override.yml \
  up -d --no-deps --no-build --pull never --wait web
```

## Verification

- `web-1` is healthy on
  `sha256:5152ee55ea518cfebe231f9a6f888809391f84ac8620fb33dce7e7f517ab473f`.
- The container and public application both serve
  `assets/index-ZYqsBjrS.js`.
- Public health returned HTTP 200.
- API, orchestrator, and cloud-control image identities and start times were
  unchanged by the targeted apply.
- The orchestrator was not restarted, so live WhatsApp sessions were not
  interrupted.
- Existing tabs must reload once to execute the corrected web bundle.

One old tab continued running the pre-release bundle after the deploy and kept
issuing roughly 600 authenticated contact requests per minute. With owner
approval, only the session identified by the incident report's access token was
confirmed active and deleted from `user_sessions`; no other session was
changed. The client then received 401 responses and stopped. In the final
one-minute recovery sample:

- `/api/contacts` fell to three requests, all HTTP 200;
- contact-list median latency recovered to 182 ms;
- API readiness had a 50 ms median and no failure;
- HAProxy recorded no backend-down event, 502, or 503; and
- host load fell from above 20 to 7.95 and continued trending down.

## Rollback

The prior web image remains pinned as `wateaminbox/web:62f418f.693cd01` at
`sha256:4ebc09ffaba15f9bbee664df2132a0a95f45032223731e3b5028d7335663bbc7`.
To roll back only the frontend:

```sh
docker image tag \
  wateaminbox/web:62f418f.693cd01 \
  wateaminbox/web:080263f

docker compose --env-file /opt/wateaminbox-cloud-control/.env.production \
  -f /opt/wateaminbox/compose.production.yml \
  -f /opt/wateaminbox-cloud-control/deploy/compose.production.override.yml \
  up -d --no-deps --no-build --pull never --wait web
```
