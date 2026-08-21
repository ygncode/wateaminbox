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
docker exec -i "$database" psql -U postgres -d wateaminbox -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE ROLE wateaminbox_worker_runtime NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT CONNECT ON DATABASE wateaminbox TO wateaminbox_worker_runtime;
CREATE SCHEMA whatsapp_sessions;
CREATE TABLE whatsapp_sessions.device (id integer PRIMARY KEY);
CREATE SEQUENCE whatsapp_sessions.runtime_sequence;
GRANT USAGE ON SCHEMA whatsapp_sessions TO wateaminbox_worker_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA whatsapp_sessions TO wateaminbox_worker_runtime;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA whatsapp_sessions TO wateaminbox_worker_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA whatsapp_sessions GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO wateaminbox_worker_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA whatsapp_sessions GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO wateaminbox_worker_runtime;
SQL

run_provisioner() {
  docker run --rm --network "$network" \
    -e POSTGRES_USER=postgres -e POSTGRES_DB=wateaminbox \
    -e POSTGRES_PASSWORD_FILE=/run/secrets/postgres_password \
    -e WORKER_POSTGRES_PASSWORD_FILE=/run/secrets/worker_postgres_password \
    -v "$ROOT/infrastructure/postgres/provision-worker-role.sh:/provision:ro" \
    -v "$tmp/admin:/run/secrets/postgres_password:ro" \
    -v "$tmp/worker:/run/secrets/worker_postgres_password:ro" \
    postgres:18.1-alpine /bin/sh "$@" /provision
}

cat >"$tmp/psql" <<'FAKE_PSQL'
#!/bin/sh
: > /test-state/psql-called
exit 99
FAKE_PSQL
chmod 0755 "$tmp/psql"

run_development_provisioner() {
  docker run --rm --network "$network" \
    -e POSTGRES_USER=postgres -e POSTGRES_DB=wateaminbox \
    -e POSTGRES_PASSWORD_FILE=/run/secrets/postgres_password \
    -e WORKER_POSTGRES_PASSWORD_FILE=/run/secrets/worker_postgres_password \
    -e ALLOW_INSECURE_DEVELOPMENT_ADMIN_CREDENTIAL=true \
    -v "$ROOT/infrastructure/postgres/provision-worker-role.sh:/provision:ro" \
    -v "$tmp/admin:/run/secrets/postgres_password:ro" \
    -v "$tmp/worker:/run/secrets/worker_postgres_password:ro" \
    postgres:18.1-alpine /bin/sh /provision
}

run_provisioner_with_sql_tripwire() {
  docker run --rm --network "$network" \
    -e POSTGRES_USER=postgres -e POSTGRES_DB=wateaminbox \
    -e POSTGRES_PASSWORD_FILE=/run/secrets/postgres_password \
    -e WORKER_POSTGRES_PASSWORD_FILE=/run/secrets/worker_postgres_password \
    -e PATH=/test-state:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    -v "$ROOT/infrastructure/postgres/provision-worker-role.sh:/provision:ro" \
    -v "$tmp:/test-state" \
    -v "$tmp/admin:/run/secrets/postgres_password:ro" \
    -v "$tmp/worker:/run/secrets/worker_postgres_password:ro" \
    postgres:18.1-alpine /bin/sh /provision
}

assert_worker_role_absent() {
  local count
  count=$(docker exec "$database" psql -U postgres -d wateaminbox -Atc \
    "SELECT count(*) FROM pg_roles WHERE rolname = 'wateaminbox_worker'")
  [[ $count == 0 ]] || {
    echo "invalid credentials touched the worker role" >&2
    exit 1
  }
}

expect_rejected_without_touch() {
  local label=$1
  local output
  rm -f "$tmp/psql-called"
  if output=$(run_provisioner_with_sql_tripwire 2>&1); then
    echo "provisioner accepted $label credentials" >&2
    exit 1
  fi
  [[ $output != *"$(<"$tmp/admin")"* && $output != *"$(<"$tmp/worker")"* ]] || {
    echo "provisioner logged a credential while rejecting $label credentials" >&2
    exit 1
  }
  [[ ! -e $tmp/psql-called ]] || {
    echo "provisioner contacted SQL while rejecting $label credentials" >&2
    exit 1
  }
  assert_worker_role_absent
}

printf '%s' 'malformed administrator credential!' >"$tmp/admin"
printf '%s' "$worker_password" >"$tmp/worker"
expect_rejected_without_touch 'a malformed administrator'

printf '%s' "$admin_password" >"$tmp/admin"
printf '%s' 'malformed worker credential!' >"$tmp/worker"
expect_rejected_without_touch 'a malformed worker'

printf '%s' "$admin_password" >"$tmp/admin"
printf '%s' "$admin_password" >"$tmp/worker"
expect_rejected_without_touch 'reused administrator/worker'

printf '%s' "$admin_password" >"$tmp/admin"
printf '%s' "$worker_password" >"$tmp/worker"
output=$(run_provisioner 2>&1)
[[ $output != *"$admin_password"* && $output != *"$worker_password"* ]]

result=$(docker exec -e PGPASSWORD="$worker_password" "$database" \
  psql -h 127.0.0.1 -U wateaminbox_worker -d wateaminbox -Atc \
  "SELECT current_user, pg_has_role(current_user, 'wateaminbox_worker_runtime', 'member')")
[[ $result == 'wateaminbox_worker|t' ]]

# Even an explicitly traced invocation must disable tracing before reading or
# exporting either credential.
trace_output=$(run_provisioner -x 2>&1)
[[ $trace_output != *"$admin_password"* && $trace_output != *"$worker_password"* ]]

admin_sql() {
  docker exec "$database" psql -U postgres -d wateaminbox -v ON_ERROR_STOP=1 -c "$1" >/dev/null
}

expect_role_policy_rejected() {
  local label=$1
  local policy_output
  if policy_output=$(run_provisioner 2>&1); then
    echo "provisioner accepted $label" >&2
    exit 1
  fi
  [[ $policy_output != *"$admin_password"* && $policy_output != *"$worker_password"* ]]
  local current
  current=$(docker exec -e PGPASSWORD="$worker_password" "$database" \
    psql -h 127.0.0.1 -U wateaminbox_worker -d wateaminbox -Atc 'SELECT current_user')
  [[ $current == 'wateaminbox_worker' ]] || {
    echo "rejected $label changed the existing worker login" >&2
    exit 1
  }
}

admin_sql 'ALTER ROLE wateaminbox_worker SUPERUSER'
expect_role_policy_rejected 'a superuser worker role'
admin_sql 'ALTER ROLE wateaminbox_worker NOSUPERUSER'

admin_sql 'ALTER ROLE wateaminbox_worker_runtime BYPASSRLS'
expect_role_policy_rejected 'a BYPASSRLS runtime role'
admin_sql 'ALTER ROLE wateaminbox_worker_runtime NOBYPASSRLS'

admin_sql 'CREATE ROLE worker_forbidden_parent NOLOGIN; GRANT worker_forbidden_parent TO wateaminbox_worker'
expect_role_policy_rejected 'an unexpected role membership'
admin_sql 'REVOKE worker_forbidden_parent FROM wateaminbox_worker; DROP ROLE worker_forbidden_parent'

admin_sql 'GRANT wateaminbox_worker_runtime TO wateaminbox_worker WITH ADMIN OPTION'
expect_role_policy_rejected 'an ADMIN OPTION on the runtime membership'
admin_sql 'REVOKE ADMIN OPTION FOR wateaminbox_worker_runtime FROM wateaminbox_worker'

admin_sql 'CREATE ROLE worker_forbidden_member NOLOGIN; GRANT wateaminbox_worker TO worker_forbidden_member'
expect_role_policy_rejected 'an unexpected member of the worker login role'
admin_sql 'REVOKE wateaminbox_worker FROM worker_forbidden_member; DROP ROLE worker_forbidden_member'

admin_sql 'CREATE TABLE public.worker_owned_object (id integer); ALTER TABLE public.worker_owned_object OWNER TO wateaminbox_worker'
expect_role_policy_rejected 'worker-owned database objects'
admin_sql 'ALTER TABLE public.worker_owned_object OWNER TO postgres; DROP TABLE public.worker_owned_object'

admin_sql 'GRANT SELECT ON whatsapp_sessions.device TO wateaminbox_worker'
expect_role_policy_rejected 'a direct worker object grant'
admin_sql 'REVOKE SELECT ON whatsapp_sessions.device FROM wateaminbox_worker'

admin_sql 'GRANT CREATE ON SCHEMA whatsapp_sessions TO wateaminbox_worker'
expect_role_policy_rejected 'worker schema-create authority'
admin_sql 'REVOKE CREATE ON SCHEMA whatsapp_sessions FROM wateaminbox_worker'

admin_sql 'ALTER DEFAULT PRIVILEGES IN SCHEMA whatsapp_sessions GRANT TRUNCATE ON TABLES TO wateaminbox_worker_runtime'
expect_role_policy_rejected 'an unexpected runtime default privilege'
admin_sql 'ALTER DEFAULT PRIVILEGES IN SCHEMA whatsapp_sessions REVOKE TRUNCATE ON TABLES FROM wateaminbox_worker_runtime'

matrix=$(docker exec "$database" psql -U postgres -d wateaminbox -Atc "
  SELECT concat_ws('|',
    (SELECT rolcanlogin AND rolinherit AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls FROM pg_roles WHERE rolname='wateaminbox_worker'),
    (SELECT NOT rolcanlogin AND rolinherit AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls FROM pg_roles WHERE rolname='wateaminbox_worker_runtime'),
    pg_has_role('wateaminbox_worker', 'wateaminbox_worker_runtime', 'member'),
    has_schema_privilege('wateaminbox_worker', 'whatsapp_sessions', 'USAGE'),
    NOT has_schema_privilege('wateaminbox_worker', 'whatsapp_sessions', 'CREATE'),
    has_table_privilege('wateaminbox_worker', 'whatsapp_sessions.device', 'SELECT,INSERT,UPDATE,DELETE')
  )")
[[ $matrix == 't|t|t|t|t|t' ]]

# A rejected reuse attempt after provisioning must not rotate the existing
# worker password or otherwise touch the login.
printf '%s' "$admin_password" >"$tmp/worker"
rm -f "$tmp/psql-called"
if output=$(run_provisioner_with_sql_tripwire 2>&1); then
  echo "provisioner accepted reused credentials after provisioning" >&2
  exit 1
fi
[[ $output != *"$admin_password"* ]]
[[ ! -e $tmp/psql-called ]]
result=$(docker exec -e PGPASSWORD="$worker_password" "$database" \
  psql -h 127.0.0.1 -U wateaminbox_worker -d wateaminbox -Atc 'SELECT current_user')
[[ $result == 'wateaminbox_worker' ]]

rm -f "$tmp/worker"
if run_provisioner >/dev/null 2>&1; then
  echo "provisioner accepted a missing worker credential" >&2
  exit 1
fi
# Linux Docker's -v compatibility syntax creates a directory at a missing
# bind-mount source; remove it before restoring the credential fixture.
rm -rf "$tmp/worker"

# The explicit development-only exception supports historical local volumes
# whose administrator password is "postgres". It never relaxes worker secrets
# and remains rejected when the flag is absent.
dev_worker_password='DevelopmentWorker_0123456789abcdef'
docker exec "$database" psql -U postgres -d wateaminbox -v ON_ERROR_STOP=1 \
  -c "ALTER ROLE postgres PASSWORD 'postgres'" >/dev/null
printf '%s' 'postgres' >"$tmp/admin"
printf '%s' "$dev_worker_password" >"$tmp/worker"
if run_provisioner >/dev/null 2>&1; then
  echo "provisioner accepted a short administrator credential without the development flag" >&2
  exit 1
fi
dev_output=$(run_development_provisioner 2>&1)
[[ $dev_output != *"postgres"* && $dev_output != *"$dev_worker_password"* ]]
result=$(docker exec -e PGPASSWORD="$dev_worker_password" "$database" \
  psql -h 127.0.0.1 -U wateaminbox_worker -d wateaminbox -Atc 'SELECT current_user')
[[ $result == 'wateaminbox_worker' ]]

echo "ok - worker PostgreSQL secrets reject malformed/reused values without logging or role changes"
