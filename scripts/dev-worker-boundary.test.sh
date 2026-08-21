#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
network="dev-worker-boundary-$$"
nats_container="dev-worker-nats-$$"
cleanup() {
  docker rm -f "$nats_container" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT
cp "$ROOT/.env.example" "$tmp/dev.env"

(
  cd "$ROOT"
  DEV_ENV_FILE="$tmp/dev.env" DEV_RUNTIME_DIR="$tmp/runtime" \
    ./dev-start.sh --check-worker-boundary >/dev/null
)
for file in postgres_password worker_postgres_password nats_service_password nats_worker_password nats.conf; do
  [[ -s $tmp/runtime/$file ]] || { echo "dev-start did not create $file" >&2; exit 1; }
done
[[ $(stat -f '%Lp' "$tmp/runtime/nats.conf" 2>/dev/null || stat -c '%a' "$tmp/runtime/nats.conf") == 600 ]]
docker run --rm -v "$tmp/runtime/nats.conf:/etc/nats/nats.conf:ro" \
  nats:2.10.26-alpine -t -c /etc/nats/nats.conf >/dev/null

service_password=$(<"$tmp/runtime/nats_service_password")
worker_password=$(<"$tmp/runtime/nats_worker_password")
[[ $service_password != "$worker_password" ]]

docker network create "$network" >/dev/null
docker run -d --name "$nats_container" --network "$network" --network-alias nats \
  -v "$tmp/runtime/nats.conf:/etc/nats/nats.conf:ro" \
  nats:2.10.26-alpine -c /etc/nats/nats.conf >/dev/null
for _ in $(seq 1 50); do
  if docker exec "$nats_container" wget -q -O /dev/null http://127.0.0.1:8222/healthz 2>/dev/null; then break; fi
  sleep 0.1
done
service_rtt=$(docker run --rm --network "$network" \
  -e NATS_USER=service -e NATS_PASSWORD="$service_password" natsio/nats-box:latest \
  nats --server nats://nats:4222 rtt 1 2>&1)
worker_rtt=$(docker run --rm --network "$network" \
  -e NATS_USER=worker -e NATS_PASSWORD="$worker_password" natsio/nats-box:latest \
  nats --server nats://nats:4222 rtt 1 2>&1)
[[ $service_rtt != *"Authorization Violation"* && $worker_rtt != *"Authorization Violation"* ]]
anonymous_rtt=$(docker run --rm --network "$network" natsio/nats-box:latest \
  nats --server nats://nats:4222 rtt 1 2>&1 || true)
if [[ $anonymous_rtt != *"Authorization Violation"* ]]; then
  echo "development NATS accepted an anonymous connection" >&2
  exit 1
fi

# A reused local NATS credential must fail before rendering a configuration and
# must not appear in diagnostics.
sd '^NATS_WORKER_PASSWORD=.*' "NATS_WORKER_PASSWORD=$service_password" "$tmp/dev.env"
sd '^WORKER_NATS_URL=.*' "WORKER_NATS_URL=nats://worker:$service_password@localhost:4448" "$tmp/dev.env"
rm -rf "$tmp/reused-runtime"
if output=$(cd "$ROOT" && DEV_ENV_FILE="$tmp/dev.env" DEV_RUNTIME_DIR="$tmp/reused-runtime" \
  ./dev-start.sh --check-worker-boundary 2>&1); then
  echo "dev-start accepted a reused NATS credential" >&2
  exit 1
fi
[[ $output != *"$service_password"* ]]
[[ ! -e $tmp/reused-runtime/nats.conf ]]

# Compose must consume the generated authenticated config and expose a
# development-only role provisioner; production Compose must never enable its
# short-admin-password exception.
cp "$ROOT/.env.example" "$tmp/dev.env"
(
  cd "$ROOT"
  DEV_RUNTIME_DIR="$tmp/runtime" docker compose --env-file "$tmp/dev.env" \
    -f docker-compose.yml --profile setup config --format json >"$tmp/compose.json"
)
jq -e '
  .services.nats.command == ["--config", "/etc/nats/nats.conf"] and
  .services["worker-credential-provisioner"].environment.ALLOW_INSECURE_DEVELOPMENT_ADMIN_CREDENTIAL == "true"
' "$tmp/compose.json" >/dev/null
if docker compose --env-file "$ROOT/.env.production.example" -f "$ROOT/compose.production.yml" \
  config --format json | jq -e '.services[]?.environment.ALLOW_INSECURE_DEVELOPMENT_ADMIN_CREDENTIAL? == "true"' >/dev/null; then
  echo "production Compose enabled the development admin-password exception" >&2
  exit 1
fi

migration_line=$(rg -n '^    run_migrations$' "$ROOT/dev-start.sh" | cut -d: -f1)
provision_line=$(rg -n '^    provision_development_worker_role$' "$ROOT/dev-start.sh" | cut -d: -f1)
servers_line=$(rg -n '^    start_dev_servers$' "$ROOT/dev-start.sh" | cut -d: -f1)
(( migration_line < provision_line && provision_line < servers_line ))

echo "ok - dev-start exercises separated local NATS and PostgreSQL worker credentials"
