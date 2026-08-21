#!/bin/sh
set -eu

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
admin_file=${POSTGRES_PASSWORD_FILE:-/run/secrets/postgres_password}
worker_file=/run/secrets/worker_postgres_password
[ -r "$admin_file" ] || { echo "provision-worker-role: missing administrator credential" >&2; exit 1; }
[ -r "$worker_file" ] || { echo "provision-worker-role: missing worker credential" >&2; exit 1; }
worker_password=$(cat "$worker_file")
case "$worker_password" in
  ''|*[!A-Za-z0-9_-]*)
    echo "provision-worker-role: worker credential must be non-empty URL-safe characters" >&2
    exit 1
    ;;
esac
[ "${#worker_password}" -ge 32 ] || {
  echo "provision-worker-role: worker credential must be at least 32 characters" >&2
  exit 1
}

export PGPASSWORD
PGPASSWORD=$(cat "$admin_file")
[ -n "$PGPASSWORD" ] || { echo "provision-worker-role: administrator credential is empty" >&2; exit 1; }

# psql reads the worker password through a fixed secret path. It is never placed
# in argv, command output, the Compose model, or a generated SQL file.
psql -v ON_ERROR_STOP=1 -h postgres -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'SQL'
\set worker_password `cat /run/secrets/worker_postgres_password`
SELECT length(:'worker_password') >= 32 AS worker_password_valid \gset
\if :worker_password_valid
\else
  \echo 'provision-worker-role: worker credential could not be loaded'
  \quit 1
\endif
DO $block$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wateaminbox_worker') THEN
    CREATE ROLE wateaminbox_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END
$block$;
ALTER ROLE wateaminbox_worker PASSWORD :'worker_password';
ALTER ROLE wateaminbox_worker SET search_path = whatsapp_sessions, pg_catalog;
GRANT wateaminbox_worker_runtime TO wateaminbox_worker;
SQL

worker_password=
PGPASSWORD=
unset PGPASSWORD
