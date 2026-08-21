#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
network="dev-worker-boundary-$$"
nats_container="dev-worker-nats-$$"
centrifugo_container="dev-worker-centrifugo-$$"
cleanup() {
  docker rm -f "$centrifugo_container" "$nats_container" >/dev/null 2>&1 || true
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

# Centrifugo reads only the service credential file, authenticates its broker
# connection, and becomes healthy without exposing that credential in logs.
docker run -d --name "$centrifugo_container" --network "$network" \
  --entrypoint /bin/sh \
  -v "$ROOT/infrastructure/centrifugo/config.json:/centrifugo/config.json:ro" \
  -v "$tmp/runtime/nats_service_password:/run/dev-secrets/nats_service_password:ro" \
  centrifugo/centrifugo:v6.9.1 -ec \
  'password=$(cat /run/dev-secrets/nats_service_password); export CENTRIFUGO_BROKER_NATS_URL="nats://service:$password@nats:4222"; exec centrifugo --config=/centrifugo/config.json' \
  >/dev/null
centrifugo_healthy=false
for _ in $(seq 1 100); do
  if docker exec "$centrifugo_container" wget -q -O /dev/null http://127.0.0.1:8000/health 2>/dev/null; then
    centrifugo_healthy=true
    break
  fi
  sleep 0.1
done
if [[ $centrifugo_healthy != true ]]; then
  echo "Centrifugo did not become healthy with the authenticated broker (logs withheld to protect credentials)" >&2
  exit 1
fi
centrifugo_logs=$(docker logs "$centrifugo_container" 2>&1)
if [[ $centrifugo_logs == *"$service_password"* || $centrifugo_logs == *"Authorization Violation"* ]]; then
  echo "Centrifugo exposed its credential or failed NATS authentication" >&2
  exit 1
fi
connz=$(docker exec "$nats_container" wget -q -O - 'http://127.0.0.1:8222/connz?auth=true')
if ! jq -e '.connections[] | select(.authorized_user == "service")' <<<"$connz" >/dev/null; then
  echo "Centrifugo has no authenticated service connection to development NATS" >&2
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
  .services.centrifugo.entrypoint == ["/bin/sh", "-ec"] and
  (.services.centrifugo.command[0] | contains("CENTRIFUGO_BROKER_NATS_URL=\"nats://service:")) and
  (.services.centrifugo.volumes[] | select(.target == "/run/dev-secrets/nats_service_password" and .read_only == true)) and
  .services["worker-credential-provisioner"].environment.ALLOW_INSECURE_DEVELOPMENT_ADMIN_CREDENTIAL == "true"
' "$tmp/compose.json" >/dev/null
if rg -F "$service_password" "$tmp/compose.json" >/dev/null; then
  echo "development Compose exposed the NATS service password in its rendered model" >&2
  exit 1
fi
docker compose --env-file "$ROOT/.env.production.example" -f "$ROOT/compose.production.yml" \
  config --format json >"$tmp/production-compose.json"
if jq -e '.services[]?.environment.ALLOW_INSECURE_DEVELOPMENT_ADMIN_CREDENTIAL? == "true"' \
  "$tmp/production-compose.json" >/dev/null; then
  echo "production Compose enabled the development admin-password exception" >&2
  exit 1
fi
jq -e '
  (.services.centrifugo.command[0] | contains("cat /run/secrets/nats_service_password")) and
  (.services.centrifugo.command[0] | contains("CENTRIFUGO_BROKER_NATS_URL=\"nats://service:")) and
  (.services.centrifugo.secrets[] | select(.source == "nats_service_password")) and
  ((.services.centrifugo.command[0] | contains("/run/dev-secrets")) | not)
' "$tmp/production-compose.json" >/dev/null

migration_line=$(rg -n '^    run_migrations$' "$ROOT/dev-start.sh" | cut -d: -f1)
provision_line=$(rg -n '^    provision_development_worker_role$' "$ROOT/dev-start.sh" | cut -d: -f1)
servers_line=$(rg -n '^    start_dev_servers$' "$ROOT/dev-start.sh" | cut -d: -f1)
(( migration_line < provision_line && provision_line < servers_line ))

echo "ok - dev-start exercises separated local NATS and PostgreSQL worker credentials"
