#!/bin/sh
set -eu
# Secret reads must remain quiet even if a caller enabled shell tracing.
set +x

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
admin_file=${POSTGRES_PASSWORD_FILE:-/run/secrets/postgres_password}
worker_file=${WORKER_POSTGRES_PASSWORD_FILE:-/run/secrets/worker_postgres_password}

read_credential() {
  label=$1
  file=$2
  [ -r "$file" ] || {
    echo "provision-worker-role: missing $label credential" >&2
    exit 1
  }
  credential=$(cat "$file")
  case "$credential" in
    ''|*[!A-Za-z0-9_-]*)
      echo "provision-worker-role: $label credential must contain only URL-safe characters" >&2
      exit 1
      ;;
  esac
  if [ "${#credential}" -lt 32 ]; then
    if [ "$label" != administrator ] || [ "${ALLOW_INSECURE_DEVELOPMENT_ADMIN_CREDENTIAL:-false}" != true ]; then
      echo "provision-worker-role: $label credential must be at least 32 characters" >&2
      exit 1
    fi
  fi
  printf '%s' "$credential"
}

# Read and validate both files before contacting PostgreSQL. In particular, a
# reused manager credential must not create or alter the worker login.
admin_password=$(read_credential administrator "$admin_file")
worker_password=$(read_credential worker "$worker_file")
[ "$admin_password" != "$worker_password" ] || {
  echo "provision-worker-role: administrator and worker credentials must differ" >&2
  exit 1
}

export PGPASSWORD="$admin_password"
export WORKER_POSTGRES_PASSWORD="$worker_password"

# psql imports the already-validated worker password from its environment. It
# is never placed in argv, command output, the Compose model, or generated SQL.
psql -q -v ON_ERROR_STOP=1 -h postgres -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'SQL'
\getenv worker_password WORKER_POSTGRES_PASSWORD
SET client_min_messages = warning;
DO $preflight$
DECLARE
  worker_oid oid := (SELECT oid FROM pg_roles WHERE rolname = 'wateaminbox_worker');
  runtime_oid oid := (SELECT oid FROM pg_roles WHERE rolname = 'wateaminbox_worker_runtime');
BEGIN
  IF runtime_oid IS NULL THEN
    RAISE EXCEPTION 'wateaminbox_worker_runtime is missing; apply migration 072 first';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'wateaminbox_worker_runtime'
      AND (rolcanlogin OR NOT rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
  ) OR EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'wateaminbox_worker'
      AND (NOT rolcanlogin OR NOT rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'worker roles have unsafe role attributes';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_auth_members membership
    WHERE membership.member = runtime_oid
       OR (membership.roleid = runtime_oid AND (
         worker_oid IS NULL OR membership.member <> worker_oid OR membership.admin_option
       ))
       OR (worker_oid IS NOT NULL AND membership.roleid = worker_oid)
       OR (worker_oid IS NOT NULL AND membership.member = worker_oid AND membership.roleid <> runtime_oid)
  ) THEN
    RAISE EXCEPTION 'worker roles have unexpected role memberships';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_shdepend
    WHERE refclassid = 'pg_authid'::regclass
      AND refobjid IN (worker_oid, runtime_oid) AND deptype = 'o'
    UNION ALL SELECT 1 FROM pg_class WHERE relowner IN (worker_oid, runtime_oid)
    UNION ALL SELECT 1 FROM pg_namespace WHERE nspowner IN (worker_oid, runtime_oid)
    UNION ALL SELECT 1 FROM pg_proc WHERE proowner IN (worker_oid, runtime_oid)
    UNION ALL SELECT 1 FROM pg_type WHERE typowner IN (worker_oid, runtime_oid)
    UNION ALL SELECT 1 FROM pg_database WHERE datdba IN (worker_oid, runtime_oid)
  ) THEN
    RAISE EXCEPTION 'worker roles must not own database objects';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_namespace schema_row
    WHERE has_schema_privilege('wateaminbox_worker_runtime', schema_row.oid, 'CREATE')
       OR (worker_oid IS NOT NULL AND has_schema_privilege('wateaminbox_worker', schema_row.oid, 'CREATE'))
  ) THEN
    RAISE EXCEPTION 'worker roles must not create schema objects';
  END IF;

  IF worker_oid IS NOT NULL AND EXISTS (
    SELECT 1 FROM pg_class object_row, LATERAL aclexplode(COALESCE(object_row.relacl, acldefault(CASE WHEN object_row.relkind = 'S' THEN 'S'::"char" ELSE 'r'::"char" END, object_row.relowner))) acl WHERE acl.grantee = worker_oid
    UNION ALL SELECT 1 FROM pg_namespace object_row, LATERAL aclexplode(COALESCE(object_row.nspacl, acldefault('n', object_row.nspowner))) acl WHERE acl.grantee = worker_oid
    UNION ALL SELECT 1 FROM pg_proc object_row, LATERAL aclexplode(COALESCE(object_row.proacl, acldefault('f', object_row.proowner))) acl WHERE acl.grantee = worker_oid
    UNION ALL SELECT 1 FROM pg_type object_row, LATERAL aclexplode(COALESCE(object_row.typacl, acldefault('T', object_row.typowner))) acl WHERE acl.grantee = worker_oid
    UNION ALL SELECT 1 FROM pg_database object_row, LATERAL aclexplode(COALESCE(object_row.datacl, acldefault('d', object_row.datdba))) acl WHERE acl.grantee = worker_oid
  ) THEN
    RAISE EXCEPTION 'wateaminbox_worker has direct object grants';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_namespace object_row,
         LATERAL aclexplode(COALESCE(object_row.nspacl, acldefault('n', object_row.nspowner))) acl
    WHERE acl.grantee = runtime_oid
      AND NOT (object_row.nspname = 'whatsapp_sessions' AND acl.privilege_type = 'USAGE')
    UNION ALL
    SELECT 1
    FROM pg_class object_row
    JOIN pg_namespace schema_row ON schema_row.oid = object_row.relnamespace,
         LATERAL aclexplode(COALESCE(object_row.relacl, acldefault(CASE WHEN object_row.relkind = 'S' THEN 'S'::"char" ELSE 'r'::"char" END, object_row.relowner))) acl
    WHERE acl.grantee = runtime_oid
      AND NOT (
        schema_row.nspname = 'whatsapp_sessions'
        AND ((object_row.relkind = 'S' AND acl.privilege_type IN ('USAGE', 'SELECT', 'UPDATE'))
          OR (object_row.relkind IN ('r', 'p', 'v', 'm', 'f') AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')))
      )
    UNION ALL SELECT 1 FROM pg_proc object_row, LATERAL aclexplode(COALESCE(object_row.proacl, acldefault('f', object_row.proowner))) acl WHERE acl.grantee = runtime_oid
    UNION ALL SELECT 1 FROM pg_type object_row, LATERAL aclexplode(COALESCE(object_row.typacl, acldefault('T', object_row.typowner))) acl WHERE acl.grantee = runtime_oid
    UNION ALL
    SELECT 1
    FROM pg_database object_row,
         LATERAL aclexplode(COALESCE(object_row.datacl, acldefault('d', object_row.datdba))) acl
    WHERE acl.grantee = runtime_oid
      AND NOT (object_row.datname = current_database() AND acl.privilege_type = 'CONNECT')
  ) THEN
    RAISE EXCEPTION 'wateaminbox_worker_runtime has grants outside the runtime matrix';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_default_acl defaults
    CROSS JOIN LATERAL aclexplode(defaults.defaclacl) acl
    LEFT JOIN pg_namespace schema_row ON schema_row.oid = defaults.defaclnamespace
    WHERE defaults.defaclrole IN (worker_oid, runtime_oid)
       OR (
        acl.grantee IN (worker_oid, runtime_oid)
        AND NOT (
          acl.grantee = runtime_oid AND schema_row.nspname = 'whatsapp_sessions'
          AND ((defaults.defaclobjtype = 'S' AND acl.privilege_type IN ('USAGE', 'SELECT', 'UPDATE'))
            OR (defaults.defaclobjtype = 'r' AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')))
        )
      )
  ) THEN
    RAISE EXCEPTION 'worker roles have unsafe default privileges';
  END IF;
END
$preflight$;
DO $block$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wateaminbox_worker') THEN
    CREATE ROLE wateaminbox_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END
$block$;
ALTER ROLE wateaminbox_worker_runtime NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE wateaminbox_worker LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE wateaminbox_worker PASSWORD :'worker_password';
ALTER ROLE wateaminbox_worker SET search_path = whatsapp_sessions, pg_catalog;
GRANT wateaminbox_worker_runtime TO wateaminbox_worker;
SQL

admin_password=
worker_password=
PGPASSWORD=
WORKER_POSTGRES_PASSWORD=
unset PGPASSWORD WORKER_POSTGRES_PASSWORD
