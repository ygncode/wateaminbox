#!/bin/sh
set -eu

# Load only explicitly configured Docker secrets. Values never appear in the
# image or Compose model; applications continue to receive their native names.
load_secret() {
  name="$1"
  file=$(printenv "${name}_FILE" 2>/dev/null || true)
  [ -n "$file" ] || return 0
  [ -r "$file" ] || {
    echo "secret-entrypoint: cannot read ${name}_FILE=$file" >&2
    exit 1
  }
  value=$(cat "$file")
  [ -n "$value" ] || {
    echo "secret-entrypoint: $file is empty" >&2
    exit 1
  }
  export "$name=$value"
  unset "${name}_FILE"
}

# The selected mail provider's key arrives through one provider-neutral mount,
# so at most one provider variable may name a given file. Two providers naming
# the same file would hand one provider's key to the other on the next send.
if [ -n "${RESEND_API_KEY_FILE:-}" ] &&
  [ "${RESEND_API_KEY_FILE:-}" = "${CLOUDFLARE_EMAIL_API_TOKEN_FILE:-}" ]; then
  echo "secret-entrypoint: RESEND_API_KEY_FILE and CLOUDFLARE_EMAIL_API_TOKEN_FILE both name ${RESEND_API_KEY_FILE}; configure only the mail provider named by MAIL_DRIVER" >&2
  exit 1
fi

for name in \
  POSTGRES_PASSWORD DATABASE_URL WORKER_POSTGRES_PASSWORD WORKER_DATABASE_URL \
  NATS_SERVICE_PASSWORD NATS_URL NATS_WORKER_PASSWORD WORKER_NATS_URL \
  JWT_SECRET MEILISEARCH_API_KEY S3_ACCESS_KEY S3_SECRET_KEY \
  CENTRIFUGO_API_KEY CENTRIFUGO_TOKEN_HMAC_SECRET \
  RESEND_API_KEY CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_EMAIL_API_TOKEN \
  VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY; do
  load_secret "$name"
done

# Keep one source of truth for service credentials. These derived URLs are the
# exact DATABASE_URL and NATS_URL names consumed by the API and Go services.
if [ -z "${DATABASE_URL:-}" ] && [ -n "${POSTGRES_PASSWORD:-}" ]; then
  : "${POSTGRES_USER:?POSTGRES_USER is required to derive DATABASE_URL}"
  : "${POSTGRES_DB:?POSTGRES_DB is required to derive DATABASE_URL}"
  export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?sslmode=disable"
fi
if [ -z "${NATS_URL:-}" ] && [ -n "${NATS_SERVICE_PASSWORD:-}" ]; then
  export NATS_URL="nats://service:${NATS_SERVICE_PASSWORD}@nats:4222"
fi
if [ -n "${WORKER_POSTGRES_PASSWORD:-}" ] || [ -n "${NATS_WORKER_PASSWORD:-}" ]; then
  : "${WORKER_POSTGRES_PASSWORD:?WORKER_POSTGRES_PASSWORD is required with restricted worker credentials}"
  : "${NATS_WORKER_PASSWORD:?NATS_WORKER_PASSWORD is required with restricted worker credentials}"
  : "${POSTGRES_DB:?POSTGRES_DB is required to derive WORKER_DATABASE_URL}"
  export WORKER_DATABASE_URL="postgresql://wateaminbox_worker:${WORKER_POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?sslmode=disable"
  export WORKER_NATS_URL="nats://worker:${NATS_WORKER_PASSWORD}@nats:4222"
fi
# Retain only the URLs consumed by services; avoid duplicate plaintext password
# variables in process environments.
unset POSTGRES_PASSWORD WORKER_POSTGRES_PASSWORD NATS_SERVICE_PASSWORD NATS_WORKER_PASSWORD

# The root orchestrator creates rollout authority at every container start.
# It lives only on a root-owned tmpfs so unprivileged worker UIDs cannot read
# either the token file or the manager's environment.
if [ -n "${EPHEMERAL_HTTP_BEARER_TOKEN_FILE:-}" ]; then
  [ "$(id -u)" = 0 ] || {
    echo "secret-entrypoint: ephemeral control authority requires root" >&2
    exit 1
  }
  control_file=$EPHEMERAL_HTTP_BEARER_TOKEN_FILE
  case "$control_file" in
    /run/wateaminbox-control/*) ;;
    *) echo "secret-entrypoint: control token must be under /run/wateaminbox-control" >&2; exit 1 ;;
  esac
  umask 077
  mkdir -p "$(dirname "$control_file")"
  token=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
  [ "${#token}" -eq 64 ] || {
    echo "secret-entrypoint: failed to generate control authority" >&2
    exit 1
  }
  rm -f "$control_file"
  printf '%s\n' "$token" >"$control_file"
  chmod 0600 "$control_file"
  export HTTP_BEARER_TOKEN_FILE="$control_file"
  unset HTTP_BEARER_TOKEN EPHEMERAL_HTTP_BEARER_TOKEN_FILE
  token=
fi

exec "$@"
