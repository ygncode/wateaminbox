#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
network="worker-role-test-$$"
database="worker-role-postgres-$$"
cleanup() {
  docker rm -f "$database" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

admin_password='AdminProvisionTest_0123456789abcdef'
worker_password='WorkerProvisionTest_0123456789abcdef'
printf '%s' "$admin_password" >"$tmp/admin"
printf '%s' "$worker_password" >"$tmp/worker"
docker network create "$network" >/dev/null
docker run -d --name "$database" --network "$network" --network-alias postgres \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD="$admin_password" -e POSTGRES_DB=wateaminbox \
  postgres:18.1-alpine >/dev/null
for _ in $(seq 1 100); do
  if docker exec "$database" psql -U postgres -d wateaminbox -Atc 'SELECT 1' >/dev/null 2>&1; then break; fi
  sleep 0.1
done
docker exec "$database" psql -U postgres -d wateaminbox -Atc 'SELECT 1' >/dev/null
docker exec "$database" psql -U postgres -d wateaminbox -v ON_ERROR_STOP=1 \
  -c 'CREATE ROLE wateaminbox_worker_runtime NOLOGIN;' >/dev/null

output=$(docker run --rm --network "$network" \
  -e POSTGRES_USER=postgres -e POSTGRES_DB=wateaminbox \
  -e POSTGRES_PASSWORD_FILE=/run/secrets/postgres_password \
  -v "$ROOT/infrastructure/postgres/provision-worker-role.sh:/provision:ro" \
  -v "$tmp/admin:/run/secrets/postgres_password:ro" \
  -v "$tmp/worker:/run/secrets/worker_postgres_password:ro" \
  postgres:18.1-alpine /bin/sh /provision)
[[ $output != *"$admin_password"* && $output != *"$worker_password"* ]]

result=$(docker exec -e PGPASSWORD="$worker_password" "$database" \
  psql -h 127.0.0.1 -U wateaminbox_worker -d wateaminbox -Atc \
  "SELECT current_user, pg_has_role(current_user, 'wateaminbox_worker_runtime', 'member')")
[[ $result == 'wateaminbox_worker|t' ]]

if docker run --rm --network "$network" \
  -e POSTGRES_USER=postgres -e POSTGRES_DB=wateaminbox \
  -e POSTGRES_PASSWORD_FILE=/run/secrets/postgres_password \
  -v "$ROOT/infrastructure/postgres/provision-worker-role.sh:/provision:ro" \
  -v "$tmp/admin:/run/secrets/postgres_password:ro" \
  postgres:18.1-alpine /bin/sh /provision >/dev/null 2>&1; then
  echo "provisioner accepted a missing worker credential" >&2
  exit 1
fi

echo "ok - worker PostgreSQL login is file-provisioned without credential output"
