# Self-hosted production deployment

This is a security-conscious single-host production baseline for the current
process model. It is deployment guidance, not an audit, certification, managed
service, support commitment, or guarantee of fitness for a particular environment.
It uses `compose.production.yml`; the existing `docker-compose.yml` remains the
local development stack and is intentionally not an input to production.

## Architecture and trust boundaries

Only Caddy publishes host ports (`80` and `443`, including HTTP/3 UDP). Caddy
terminates TLS and routes:

- `APP_DOMAIN`: `/api/*` to the Bun API, `/connection/*` to Centrifugo, and all
  other paths to the web SPA;
- `MARKETING_DOMAIN`: the static Astro build;
- `MEDIA_DOMAIN`: the retained legacy MinIO S3 origin during the R2 rollback
  window. New private media URLs are presigned directly against R2's account S3
  API endpoint; the MinIO console is disabled and is never routed.

PostgreSQL, NATS, Meilisearch, retained MinIO, Centrifugo, and the orchestrator have no
host port mappings. Data services share an `internal: true` network. API and
orchestrator also join an egress network because email, WhatsApp, and object
requests need outbound Internet access. The orchestrator image contains the
WhatsApp worker artifact and starts workers as child processes; do not scale the
orchestrator horizontally without changing that ownership model.

The R2 `whatsapp-media` bucket and retained MinIO source are private. Browser
access uses API-authorized, short-lived R2 signatures; neither `r2.dev` nor a
public bucket/custom domain is permitted. `MEDIA_DOMAIN` exists only so transient
legacy MinIO signatures can finish during migration. See
[the copy, verify, cutover, and rollback runbook](../.clanker/media-r2-migration.md).

## Host and DNS prerequisites

Use a supported Linux host with Docker Engine, the Compose plugin, BuildKit,
reliable storage, NTP, and enough memory for PostgreSQL and Meilisearch (8 GiB is
a practical starting point). Keep Docker and the kernel patched.

1. Point A/AAAA records for all three domains at the host. The domains must be
   distinct and globally reachable for ACME issuance.
2. Allow inbound TCP 80/443 and UDP 443. Deny every other inbound port at the
   host/cloud firewall; SSH should be restricted separately.
3. Ensure outbound HTTPS, DNS, NTP, email-provider, and WhatsApp traffic is
   allowed.
4. If `10.253.0.0/24` overlaps the host or a VPN, change `EDGE_SUBNET` and `PROXY_IP`
   together. `PROXY_IP` is also the only peer trusted by the API to supply
   `X-Forwarded-For`.

## Configuration and secrets

```sh
cp .env.production.example .env.production
chmod 600 .env.production
umask 077
mkdir -p secrets
for name in postgres_password nats_token meilisearch_master_key \
  minio_root_user minio_root_password jwt_secret centrifugo_api_key \
  centrifugo_token_secret; do
  openssl rand -hex 32 > "secrets/$name"
done
# Supply the real provider key interactively; it is not echoed or put in history.
read -r -s -p 'Resend API key: ' RESEND_API_KEY; printf '\n'
test -n "$RESEND_API_KEY"
printf '%s' "$RESEND_API_KEY" > secrets/resend_api_key
unset RESEND_API_KEY
chmod 600 secrets/*
```

Provision a new media application token scoped to the private
`whatsapp-media` bucket through the approved Cloudflare process. Install its
access key ID at `/opt/wateaminbox/secrets/r2_media_access_key_id` and its secret
at `/opt/wateaminbox/secrets/r2_media_secret_access_key`, both mode `0640` and owned by the deployment user's secrets group. Set
`S3_ACCESS_KEY_FILE` and `S3_SECRET_KEY_FILE` to those paths respectively.
Compose deliberately keeps the provider-neutral secret mounts
`/run/secrets/s3_access_key` and `/run/secrets/s3_secret_key`; the entrypoint
hydrates `S3_ACCESS_KEY` and `S3_SECRET_KEY`. Do not put token values in the env
file or command history.

Do not overwrite or rename the existing MinIO `s3_access_key` and
`s3_secret_key` host files. Keep them unchanged with the retained MinIO source
through the rollback window; rollback restores those old paths together with the
MinIO endpoint and region.

The existing backup credentials (`r2_access_key_id` and
`r2_secret_access_key`) are bucket-scoped to the backup repository. They are not
media application/inventory credentials and must not be reused for
`whatsapp-media` or copied into the `s3_*` files.

Edit `.env.production`. Secret entries are **paths**, not values. Keep secret
files out of source control and backups unless the backup is encrypted. The
hex-only generation above matters because PostgreSQL and NATS URLs are derived
from these values without URL encoding.

There are no production credential defaults: required Compose substitutions use
`${NAME:?…}`, containers reject unreadable/empty secret files, NATS requires a
random token, and Meilisearch requires a master key. `S3_ACCESS_KEY_FILE` and
`S3_SECRET_KEY_FILE` contain bucket-scoped R2 application credentials; MinIO root
credentials are retained only for the legacy source/rollback service. Development credentials in `.env.example` and
`docker-compose.yml` must never be reused.

The runtime names match the applications: `DATABASE_URL` is derived by
`secret-entrypoint.sh`; the API receives `NATS_URL` plus `NATS_TOKEN`, while the
Go services receive a derived authenticated `NATS_URL` (logging strips URL
user-info). API also receives
`MEILISEARCH_API_KEY`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `JWT_SECRET`,
`CENTRIFUGO_API_KEY`, and `CENTRIFUGO_TOKEN_HMAC_SECRET`; workers inherit the
orchestrator's `DATABASE_URL`, `NATS_URL`, and `S3_*` values. For R2 set the
path-free account S3 API endpoint, region `auto`, path style `true`, bucket
`whatsapp-media`, and a 300-second signed URL TTL. `S3_LEGACY_ENDPOINTS` lists
former MinIO path-style origins only for key recovery. Public Vite settings are
compiled into the web image. Changing a `VITE_*` value therefore requires rebuilding it.

The checked-in production Compose baseline does not mount a VAPID private key,
so background Web Push is disabled by default. To enable it, generate a VAPID pair,
set the public value in `.env.production`, and use a reviewed Compose override to
add the private value as a secret mounted through `VAPID_PRIVATE_KEY_FILE`. Do not
put the private key in the env file. If email is
intentionally disabled, use a reviewed override rather than a fake Resend key;
production defaults assume `MAIL_DRIVER=resend`.

## Build, validate, and first start

Use a unique, immutable `APP_IMAGE_TAG` for every release (for example a Git
commit or release identifier):

```sh
export COMPOSE='docker compose --env-file .env.production -f compose.production.yml'
$COMPOSE config --quiet
$COMPOSE build --pull

# Bring up dependencies, run the one-shot migration, then start the stack.
$COMPOSE up -d postgres nats meilisearch minio centrifugo
$COMPOSE run --rm migration
$COMPOSE up -d
$COMPOSE ps
```

`up` also gates API/orchestrator startup on the idempotent migration service.
Running migration explicitly makes failure visible before traffic changes.
Inspect failures with `$COMPOSE logs migration` and do not bypass a failed
migration.

Validate externally (set the domains to the values from `.env.production`):

```sh
APP_DOMAIN=inbox.example.com
MARKETING_DOMAIN=www.example.com
curl -fsS "https://$APP_DOMAIN/api/health/live"
curl -fsS "https://$APP_DOMAIN/api/health/ready"
curl -fsSI "https://$MARKETING_DOMAIN/"
$COMPOSE exec orchestrator wget -qO- http://127.0.0.1:8080/health
```

The API readiness endpoint can report `degraded` while still returning 200 when
recoverable realtime dependencies are unavailable; alert on the JSON status,
not only the HTTP status. PostgreSQL failure returns 503.

The standalone worker artifact can be built for inspection with:

```sh
docker build --target worker -f services/whatsapp/Dockerfile -t wateaminbox/worker:check .
```

It is normally supplied by the orchestrator image, not deployed as a fixed
Compose service because each worker requires per-connection identifiers.

## Reverse proxy and TLS operations

Caddy obtains and renews public certificates and persists ACME state in
`caddy_data`. Keep DNS correct and port 80 reachable for redirects/challenges.
Do not expose Caddy's admin endpoint (2019); it is used only by the container
health check. Test configuration changes before reload:

```sh
$COMPOSE exec proxy caddy validate --config /etc/caddy/Caddyfile
$COMPOSE exec proxy caddy reload --config /etc/caddy/Caddyfile
```

If TLS is terminated upstream, provide a reviewed Caddy/Compose override and
preserve HTTPS externally, WebSocket upgrades, the original host, and client IP.
Then replace `TRUSTED_PROXY_IPS` with exact direct proxy peers. Never broadly
trust forwarding headers from the Internet.

## Backups and restore drills

Define recovery point/time objectives before launch. At minimum back up:

1. **PostgreSQL**: authoritative application, tenant, WhatsApp session, and
   outbox state. Take daily custom-format logical dumps plus storage-level
   snapshots where available.
2. **R2**: all live media objects. Preserve keys, metadata, inventory reports,
   and content verification records. Retain the non-destructive MinIO source and
   its snapshot through the documented rollback window.
3. **NATS JetStream**: durable in-flight commands/events. Back up its volume only
   while NATS is stopped, or use NATS stream snapshot tooling from a private
   operations container.
4. **Meilisearch**: create authenticated dumps or archive its volume while
   stopped. Search is derived data, but retaining it shortens recovery.
5. Secret material and deployment configuration in an encrypted, access-audited
   secret/backup system. Caddy ACME data is optional to back up because
   certificates can be reissued.

Example PostgreSQL dump (the output is sensitive):

```sh
mkdir -p backups
$COMPOSE exec -T postgres sh -ec \
  'PGPASSWORD=$(cat /run/secrets/postgres_password) pg_dump \
   -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > "backups/postgres-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

For a consistent full-stack snapshot, briefly stop writers (`api` and
`orchestrator`), wait for PostgreSQL activity/outboxes to settle, take the
PostgreSQL dump and storage snapshots, then restart writers. Never copy a live
PostgreSQL data directory as a logical backup.

Restore into an isolated environment first:

1. Stop API/orchestrator and prevent public routing.
2. Restore PostgreSQL into the same major version with `pg_restore --clean
   --if-exists`, then run `migration` for the selected application release.
3. Restore media before resuming workers; retain a private bucket, the same
   `whatsapp-media` name/object keys, and stable `s3://` references.
4. Restore NATS/Meili snapshots only with compatible versions, or recreate
   derived/search state and let durable database outboxes recover supported
   messaging flows.
5. Start dependencies, API, and orchestrator; verify health and tenant/media
   sampling before restoring proxy traffic.

Perform and record restore drills. A backup that has not been restored is not a
verified backup.

## Upgrades and rollback

Before an upgrade, read migration changes, take verified PostgreSQL/media
backups, preserve the old image tag, and build/pull the new immutable tag:

```sh
# Edit APP_IMAGE_TAG in .env.production to the new release.
$COMPOSE config --quiet
$COMPOSE build --pull
$COMPOSE run --rm migration
$COMPOSE up -d --remove-orphans
$COMPOSE ps
```

Check readiness, error rates, worker reconnects, NATS backlog, and a signed media
read/write. Do not use `latest` release tags.

For an application-only rollback, restore the previous `APP_IMAGE_TAG` and run
`$COMPOSE up -d --no-build`. Database migrations are forward-only; an old binary
may not be compatible with the upgraded schema. If compatibility was not
explicitly verified, stop writers and restore the pre-upgrade PostgreSQL/media
backup instead of attempting an ad-hoc down migration. Document the resulting
data-loss window.

## Observability and maintenance

Compose uses rotated local logs; ship Docker logs off-host before relying on them
for incident response. API logs are structured in production
(`LOG_PRETTY=false`). Scrape or probe from a monitoring agent attached to the
private networks rather than publishing ports:

- API `/api/health/live` and `/api/health/ready`;
- orchestrator `/health` and worker count;
- Centrifugo `/health` and `/metrics`;
- NATS monitoring on `8222`;
- R2 signed read/write and inventory freshness/errors, retained MinIO health,
  PostgreSQL availability/replication, Meilisearch health;
- host disk/inode pressure, memory/OOMs, certificate expiry, backup age and
  restore-test age.

Alert on repeated worker restarts, NATS/outbox backlog, API readiness degradation,
5xx/latency, database connection saturation, object-storage errors, and volume
capacity. Pin and regularly review all base/service image tags; image scanning
and host vulnerability management remain operator responsibilities.

For more than one API replica, replace the in-memory rate-limit store with a
supported shared Redis deployment and test background-service concurrency. The
provided baseline intentionally runs one API and one orchestrator.
