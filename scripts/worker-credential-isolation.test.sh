#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
printf '%s' 'AdminPassword_0123456789abcdef' >"$tmp/admin-db"
printf '%s' 'WorkerPassword_0123456789abcdef' >"$tmp/worker-db"
printf '%s' 'ServicePassword_0123456789abcdef' >"$tmp/service-nats"
printf '%s' 'WorkerNATSPassword_0123456789abcdef' >"$tmp/worker-nats"

output=$(docker run --rm \
  -e POSTGRES_USER=service -e POSTGRES_DB=wateaminbox \
  -e POSTGRES_PASSWORD_FILE=/secrets/admin-db \
  -e WORKER_POSTGRES_PASSWORD_FILE=/secrets/worker-db \
  -e NATS_SERVICE_PASSWORD_FILE=/secrets/service-nats \
  -e NATS_WORKER_PASSWORD_FILE=/secrets/worker-nats \
  -v "$tmp:/secrets:ro" \
  -v "$ROOT/infrastructure/docker/secret-entrypoint.sh:/entrypoint:ro" \
  alpine:3.22 /bin/sh /entrypoint sh -ec '
    case "$DATABASE_URL" in postgresql://service:AdminPassword_*@postgres:5432/*) ;; *) exit 1;; esac
    case "$WORKER_DATABASE_URL" in postgresql://wateaminbox_worker:WorkerPassword_*@postgres:5432/*) ;; *) exit 1;; esac
    case "$NATS_URL" in nats://service:ServicePassword_*@nats:4222) ;; *) exit 1;; esac
    case "$WORKER_NATS_URL" in nats://worker:WorkerNATSPassword_*@nats:4222) ;; *) exit 1;; esac
    test "$DATABASE_URL" != "$WORKER_DATABASE_URL"
    test "$NATS_URL" != "$WORKER_NATS_URL"
    test -z "${POSTGRES_PASSWORD-}${WORKER_POSTGRES_PASSWORD-}${NATS_SERVICE_PASSWORD-}${NATS_WORKER_PASSWORD-}"
    printf ok
  ')
[[ $output == ok ]]

if docker run --rm \
  -e POSTGRES_DB=wateaminbox \
  -e WORKER_POSTGRES_PASSWORD_FILE=/secrets/worker-db \
  -v "$tmp:/secrets:ro" \
  -v "$ROOT/infrastructure/docker/secret-entrypoint.sh:/entrypoint:ro" \
  alpine:3.22 /bin/sh /entrypoint true >/dev/null 2>&1; then
  echo "entrypoint accepted incomplete restricted worker credentials" >&2
  exit 1
fi

json="$tmp/compose.json"
docker compose --env-file "$ROOT/.env.production.example" -f "$ROOT/compose.production.yml" config --format json >"$json"
if rg -n 'ConnectedUrl\(\)' \
  "$ROOT/services/whatsapp/internal/nats/publisher.go" \
  "$ROOT/services/whatsapp/internal/nats/subscriber.go" >/dev/null; then
  echo "worker NATS reconnect logging uses an unredacted URL" >&2
  exit 1
fi
for source in \
  "$ROOT/services/whatsapp/internal/nats/publisher.go" \
  "$ROOT/services/whatsapp/internal/nats/subscriber.go" \
  "$ROOT/services/whatsapp/internal/handler/download.go"; do
  rg -q 'RedactErrorForURL' "$source" || {
    echo "worker NATS error path is not credential-redacted: $source" >&2
    exit 1
  }
done

jq -e '
  .services.orchestrator.environment.WORKER_POSTGRES_PASSWORD_FILE == "/run/secrets/worker_postgres_password" and
  .services.orchestrator.environment.NATS_WORKER_PASSWORD_FILE == "/run/secrets/nats_worker_password" and
  .services.orchestrator.depends_on["worker-credential-provisioner"].condition == "service_completed_successfully" and
  (.services.nats.secrets | map(.source) | index("nats_service_password") != null) and
  (.services.nats.secrets | map(.source) | index("nats_worker_password") != null) and
  (.services.orchestrator.secrets | map(.source) | index("worker_postgres_password") != null) and
  (.services.api.secrets | map(.source) | index("nats_worker_password") == null)
' "$json" >/dev/null

echo "ok - restricted worker credentials are mandatory, distinct, and file-hydrated"
