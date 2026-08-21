# Worker control-plane credential isolation

This runbook covers the mandatory migration from shared service credentials to
a restricted WhatsApp-worker NATS user and PostgreSQL role. It does **not**
authorize production changes by itself. Generate, install, rotate, or roll back
live credentials only in an approved maintenance window with a recovery owner.

## Security boundary

WhatsApp workers are trusted backend processes, not tenant sandboxes. This
change prevents a compromised worker credential from writing manager lifecycle
or rollout NATS subjects and from reading or mutating PostgreSQL control-plane
tables. It does not provide per-connection isolation:

- all workers currently share the restricted NATS user and can reach the
  worker data-plane subject families;
- all workers currently share the PostgreSQL runtime role and can reach all
  rows in `whatsapp_sessions`;
- workers retain the shared media S3/R2 credential and broader WhatsApp
  data-plane authority;
- distinct Linux UIDs and the root-only HTTP bearer protect local manager
  authority, but do not establish complete tenant isolation.

Per-worker NATS users, PostgreSQL RLS/session brokers, and per-tenant S3
credentials or a media broker are a separate security architecture program.
Do not describe the current boundary as complete tenant isolation.

## Required secret files

Create three new mode-0600, operative-owned files containing independent,
URL-safe random values of at least 32 characters:

- `worker_postgres_password`
- `nats_service_password`
- `nats_worker_password`

The service and worker NATS passwords must differ. The worker PostgreSQL
password must not reuse the application PostgreSQL password. Never place values
in `.env.production`, shell history, Compose YAML, tickets, or logs. Configure
only their file paths:

```dotenv
WORKER_POSTGRES_PASSWORD_FILE=/opt/wateaminbox/secrets/worker_postgres_password
NATS_SERVICE_PASSWORD_FILE=/opt/wateaminbox/secrets/nats_service_password
NATS_WORKER_PASSWORD_FILE=/opt/wateaminbox/secrets/nats_worker_password
```

Retain the previous `nats_token` and application database secret unchanged
through the rollback window; do not repurpose either file under a new name.

## First migration

1. Take the normal database and NATS recovery checkpoints.
2. Install the three new files without printing them.
3. Run Compose configuration validation. Missing files or paths must abort.
4. Stage the worker artifact.
5. Apply migration 072. It creates only the NOLOGIN
   `wateaminbox_worker_runtime` grant role; it contains no password.
6. Run `worker-credential-provisioner`. It creates/rotates the
   `wateaminbox_worker` login from the mounted file without putting the password
   in argv or generated SQL. It rejects reused credentials before contacting
   PostgreSQL and rejects preexisting worker roles with unsafe attributes,
   memberships, ownership, direct/default grants, or schema-create authority.
7. Recreate NATS, API, Centrifugo, and orchestrator. NATS starts with separate
   `service` and `worker` users; the orchestrator passes only the restricted
   worker URLs to child processes.
8. Wait for worker reconnect/readiness and validate representative send,
   receive, media-download, unlink, restart, and rollout paths.
9. Run the permission probes below before ending the window.

Centrifugo runs through the repository-built `centrifugo-secret-entrypoint`.
The wrapper reads the service password from the Docker secret, constructs the
broker URL only in the child process environment, and literally redacts every
configured file-backed secret from both output streams across write boundaries.
It registers and forwards TERM, INT, and HUP across process startup and preserves
the child exit status. The wrapper catches its own SIGPIPE before startup, so a
closed stdout/stderr sink becomes a retained EPIPE while the child pipe stays
open and drained; the exec'd Centrifugo child retains normal SIGPIPE behavior.
Status 74 is used only when Centrifugo otherwise exits successfully,
while a natural nonzero Centrifugo status remains authoritative. Do not replace
it with a shell URL wrapper: Centrifugo includes the complete broker URL
in fatal authentication errors.

Expected database boundary:

- `wateaminbox_worker` can perform DML only in `whatsapp_sessions`, including
  future tables/sequences created by the migration owner;
- it cannot perform DML on `worker_registry`, `worker_upgrade_batches`,
  `worker_upgrade_items`, `companies`, migration tables, public control tables,
  or tenant schemas;
- it cannot create public objects or execute application-owned functions.

Expected NATS boundary:

- the privileged orchestrator creates/updates every stream and the API event
  consumer before it launches workers; worker publishers only publish;
- worker publish: `WHATSAPP.events.>` and generation-scoped
  `WHATSAPP.workers.>` plus exact command/download stream-info, consumer
  create/info/update, command pull, download cleanup, and ACK APIs;
- worker subscribe: command and media-download data-plane subjects plus reply
  inboxes;
- denied worker publish: commands, lifecycle, rollout, control, stream mutation,
  account/server administration, and unrelated subjects.

Repository probes:

```sh
./scripts/worker-credential-isolation.test.sh
./scripts/nats-worker-permissions.test.sh
./scripts/worker-postgres-provisioner.test.sh
RUN_DB_INTEGRATION=1 DATABASE_URL='postgresql://…' \
  bun test packages/database/src/worker-role-security.integration.test.ts
```

## Connection-preservation evidence and limits

Migration 072 performs role/ACL DDL only. The real-PostgreSQL integration test
fingerprints `worker_registry` and `whatsmeow_device` before and after applying
the migration and requires byte-for-byte row equality. The hostile-SQL test then
uses a restricted login against the existing schema. The provisioner changes
only role membership/password and never updates session or registry tables.

The orchestrator's existing shutdown path marks every desired-running launch for
recovery before signaling children, waits for process exit, and retains all
`whatsapp_sessions` rows. Replacement workers use the same connection IDs and
session records under the new role. NATS retains JetStream state on `nats_data`,
and the worker event outbox retains events rejected during the NATS credential
restart. Existing stop/recovery, first-launch CAS, rollout recovery, Go race, and
WhatsApp integration tests remain mandatory in the same validation run.

This is preservation of durable sessions and queued data, not a zero-disruption
promise. NATS and orchestrator recreation cause a bounded reconnect window. If
any worker fails to reconnect with its existing session, if the restricted role
cannot read runtime tables, or if permission errors affect allowed NATS
subjects, stop the cutover and use the rollback procedure; do not grant broader
control-plane access to meet a schedule.

## Rotation

Rotate one boundary at a time. Create a new file atomically, preserve the old
file for rollback, then force the affected services to recreate; changing a
bind-mounted secret's contents alone is not proof that Compose replaced a
container.

- PostgreSQL worker password: rerun `worker-credential-provisioner`, then force
  recreate orchestrator so every child receives the new URL. Existing worker
  pools using the old password can continue until disconnected, so complete the
  orchestrator replacement in the same window.
- Worker NATS password: replace the file, force recreate NATS and orchestrator,
  then verify command consumption and event publication.
- Service NATS password: replace the file, force recreate NATS, API,
  orchestrator, and Centrifugo, then verify all consumers and publishers.

Do not log generated URLs. Validate identity through role/user names and
permission probes, not by echoing credentials.

## Rollback

Migration 072 is compatible with the new application rollback path, but an old
release expects the former single NATS token and passes the manager database URL
to workers. Rolling application code back across this boundary therefore
reopens the original control-plane exposure and is not a routine image rollback.

If emergency rollback is approved:

1. stop command ingestion and all workers;
2. preserve the 072 role and new secret files for forward recovery;
3. restore the previous NATS authentication configuration and its retained
   `nats_token` file as one atomic service change;
4. roll back application images and recreate API, Centrifugo, orchestrator, and
   NATS together;
5. verify no mixed old/new workers remain;
6. schedule immediate forward repair.

Never drop the restricted role, delete old secret files, or rewrite session data
during incident rollback. Database migration down is for isolated validation,
not the preferred production recovery mechanism.
