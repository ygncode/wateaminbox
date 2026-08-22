#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
container="wateaminbox-nats-permissions-$$"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

printf '%s' 'ServicePermissionTest_0123456789abcdef' >"$tmp/service"
printf '%s' 'WorkerPermissionTest_0123456789abcdef0' >"$tmp/worker"
NATS_SERVICE_PASSWORD_FILE="$tmp/service" \
NATS_WORKER_PASSWORD_FILE="$tmp/worker" \
NATS_CONFIG_OUTPUT="$tmp/nats.conf" \
  "$ROOT/infrastructure/nats/render-config.sh"
if NATS_SERVICE_PASSWORD_FILE="$tmp/service" \
  NATS_WORKER_PASSWORD_FILE="$tmp/service" \
  NATS_CONFIG_OUTPUT="$tmp/reused.conf" \
  "$ROOT/infrastructure/nats/render-config.sh" >/dev/null 2>&1; then
  echo "NATS renderer accepted a reused service/worker credential" >&2
  exit 1
fi

docker run -d --name "$container" -p 127.0.0.1::4222 \
  -v "$tmp/nats.conf:/etc/nats/nats.conf:ro" \
  nats:2.10.26-alpine -js -c /etc/nats/nats.conf >/dev/null
port=$(docker port "$container" 4222/tcp | awk -F: 'NR==1 {print $NF}')
for _ in $(seq 1 50); do
  if docker exec "$container" wget -q -O /dev/null http://127.0.0.1:8222/healthz 2>/dev/null; then
    break
  fi
  sleep 0.1
done
docker exec "$container" wget -q -O /dev/null http://127.0.0.1:8222/healthz

cd "$ROOT/services/shared"
service_url="nats://service:ServicePermissionTest_0123456789abcdef@127.0.0.1:$port"
worker_url="nats://worker:WorkerPermissionTest_0123456789abcdef0@127.0.0.1:$port"
NATS_SERVICE_TEST_URL="$service_url" NATS_WORKER_TEST_URL="$worker_url" \
  go test -count=1 -run TestRestrictedWorkerNATSPermissionMatrix ./nats

cd "$ROOT/services/whatsapp"
NATS_SERVICE_TEST_URL="$service_url" NATS_WORKER_TEST_URL="$worker_url" \
  go test -count=1 -run TestRestrictedWorkerNATSStartsProductionClients ./internal/handler
