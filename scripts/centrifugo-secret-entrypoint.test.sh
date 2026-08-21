#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
containers=()
cleanup() {
  if ((${#containers[@]})); then
    docker rm -f "${containers[@]}" >/dev/null 2>&1 || true
  fi
  rm -rf "$tmp"
}
trap cleanup EXIT

(
  cd "$ROOT/infrastructure/centrifugo/entrypoint"
  go test ./...
)
docker build -f "$ROOT/infrastructure/centrifugo/Dockerfile" \
  -t wateaminbox/centrifugo:v6.9.1-redacted "$ROOT" >/dev/null
if [[ $(docker image inspect wateaminbox/centrifugo:v6.9.1-redacted --format '{{.Config.User}}') != centrifugo ]]; then
  echo "Centrifugo wrapper image does not retain the unprivileged upstream user" >&2
  exit 1
fi

nats_secret='nats_chunk_boundary_secret_0123456789abcdef'
token_secret='token-regex.^$[]*+?(){}|\secret-value'
# shellcheck disable=SC2016 # literal dollar sign exercises regex-safe redaction
api_secret='api/secret&with.regex[chars]*$end'
printf '%s' "$nats_secret" >"$tmp/nats"
printf '%s' "$token_secret" >"$tmp/token"
printf '%s' "$api_secret" >"$tmp/api"
chmod 0600 "$tmp/nats" "$tmp/token" "$tmp/api"

cat >"$tmp/helper.sh" <<'HELPER'
#!/bin/sh
set -eu
emit_split() {
  file=$1
  size=$(wc -c <"$file")
  first=$((size / 2))
  dd if="$file" bs=1 count="$first" 2>/dev/null
  sleep 0.05
  dd if="$file" bs=1 skip="$first" 2>/dev/null
}
case ${1:-} in
  chunks)
    printf 'stdout-nats='
    emit_split /run/test-secrets/nats
    printf ' repeated='
    emit_split /run/test-secrets/nats
    printf '\nstdout-token='
    emit_split /run/test-secrets/token
    printf '\n'
    printf 'stderr-api=' >&2
    emit_split /run/test-secrets/api >&2
    printf '\n' >&2
    exit 23
    ;;
  high-success|high-failure|high-stderr-success|high-stderr-failure)
    i=0
    while [ "$i" -lt 50000 ]; do
      if [ "${1#high-stderr-}" != "$1" ]; then
        printf 'high-volume-output nats_chunk_boundary_secret_0123456789abcdef %s\n' "$i" >&2
      else
        printf 'high-volume-output nats_chunk_boundary_secret_0123456789abcdef %s\n' "$i"
      fi
      i=$((i + 1))
    done
    case $1 in *-success|high-success) exit 0 ;; *) exit 23 ;; esac
    ;;
  sigpipe-default)
    kill -PIPE $$
    echo 'child incorrectly inherited ignored SIGPIPE'
    exit 99
    ;;
  signals)
    trap 'echo forwarded-TERM; exit 42' TERM
    trap 'echo forwarded-INT; exit 43' INT
    trap 'echo forwarded-HUP; exit 44' HUP
    echo ready
    while :; do sleep 1; done
    ;;
  *) exit 64 ;;
esac
HELPER
chmod 0755 "$tmp/helper.sh"

run_wrapper() {
  name=$1
  shift
  containers+=("$name")
  docker run -d --name "$name" \
    --entrypoint /usr/local/bin/centrifugo-secret-entrypoint \
    -e CENTRIFUGO_NATS_PASSWORD_FILE=/run/test-secrets/nats \
    -e CENTRIFUGO_TOKEN_HMAC_SECRET_FILE=/run/test-secrets/token \
    -e CENTRIFUGO_API_KEY_FILE=/run/test-secrets/api \
    -v "$tmp/helper.sh:/usr/local/bin/test-child:ro" \
    -v "$tmp/nats:/run/test-secrets/nats:ro" \
    -v "$tmp/token:/run/test-secrets/token:ro" \
    -v "$tmp/api:/run/test-secrets/api:ro" \
    wateaminbox/centrifugo:v6.9.1-redacted /usr/local/bin/test-child "$@" >/dev/null
}

chunk_container="centrifugo-redaction-chunks-$$"
run_wrapper "$chunk_container" chunks
chunk_status=$(docker wait "$chunk_container")
chunk_logs=$(docker logs "$chunk_container" 2>&1)
if [[ $chunk_status != 23 ]]; then
  echo "wrapper did not preserve child exit status 23" >&2
  exit 1
fi
for secret in "$nats_secret" "$token_secret" "$api_secret"; do
  if [[ $chunk_logs == *"$secret"* ]]; then
    echo "wrapper leaked a secret from split output" >&2
    exit 1
  fi
  if docker inspect "$chunk_container" --format '{{json .Config.Env}} {{json .Config.Cmd}}' | rg -F "$secret" >/dev/null; then
    echo "wrapper placed a secret in Docker Config.Env or argv" >&2
    exit 1
  fi
done
redaction_count=$(rg -o '\[REDACTED\]' <<<"$chunk_logs" | wc -l | tr -d ' ')
if ((redaction_count < 4)); then
  echo "wrapper did not redact repeated, metacharacter, and chunk-split secrets" >&2
  exit 1
fi

# A broken destination must not close the child pipe. The wrapper drains and
# discards safely: 74 represents output failure only for a successful child;
# a natural nonzero child status remains authoritative instead of SIGPIPE 141.
for full_case in high-success:74 high-failure:23; do
  mode=${full_case%%:*}
  expected=${full_case##*:}
  full_container="centrifugo-redaction-${mode}-$$"
  containers+=("$full_container")
  docker run -d --name "$full_container" \
    --entrypoint /bin/sh \
    -e CENTRIFUGO_NATS_PASSWORD_FILE=/run/test-secrets/nats \
    -e CENTRIFUGO_TOKEN_HMAC_SECRET_FILE=/run/test-secrets/token \
    -e CENTRIFUGO_API_KEY_FILE=/run/test-secrets/api \
    -v "$tmp/helper.sh:/usr/local/bin/test-child:ro" \
    -v "$tmp/nats:/run/test-secrets/nats:ro" \
    -v "$tmp/token:/run/test-secrets/token:ro" \
    -v "$tmp/api:/run/test-secrets/api:ro" \
    wateaminbox/centrifugo:v6.9.1-redacted -c \
    'exec /usr/local/bin/centrifugo-secret-entrypoint /usr/local/bin/test-child "$1" >/dev/full' \
    wrapper-test "$mode" >/dev/null
  status=$(docker wait "$full_container")
  logs=$(docker logs "$full_container" 2>&1)
  if [[ $status != "$expected" || $status == 141 || $logs == *"$nats_secret"* ]]; then
    echo "/dev/full handling changed child status or leaked a secret for $mode" >&2
    exit 1
  fi
  if [[ $mode == high-success && $logs != *"failed to stream child output"* ]]; then
    echo "successful child did not report controlled output failure" >&2
    exit 1
  fi
done

# Real closed pipes exercise Go's special SIGPIPE behavior, not merely EPIPE
# returned by /dev/full. Both wrapper streams must keep draining the child.
for pipe_case in \
  stdout-success:high-success:74 \
  stdout-failure:high-failure:23 \
  stderr-success:high-stderr-success:74 \
  stderr-failure:high-stderr-failure:23; do
  stream=${pipe_case%%-*}
  remainder=${pipe_case#*:}
  mode=${remainder%%:*}
  expected=${pipe_case##*:}
  pipe_container="centrifugo-redaction-closed-${stream}-${mode}-$$"
  containers+=("$pipe_container")
  if [[ $stream == stdout ]]; then
    # shellcheck disable=SC2016 # $1 expands inside the container shell
    pipeline='exec /usr/local/bin/centrifugo-secret-entrypoint /usr/local/bin/test-child "$1" | head -c 1 >/dev/null'
  else
    # shellcheck disable=SC2016 # $1 expands inside the container shell
    pipeline='exec /usr/local/bin/centrifugo-secret-entrypoint /usr/local/bin/test-child "$1" 2>&1 >/dev/null | head -c 1 >/dev/null'
  fi
  docker run -d --name "$pipe_container" \
    --entrypoint /bin/sh \
    -e CENTRIFUGO_NATS_PASSWORD_FILE=/run/test-secrets/nats \
    -e CENTRIFUGO_TOKEN_HMAC_SECRET_FILE=/run/test-secrets/token \
    -e CENTRIFUGO_API_KEY_FILE=/run/test-secrets/api \
    -v "$tmp/helper.sh:/usr/local/bin/test-child:ro" \
    -v "$tmp/nats:/run/test-secrets/nats:ro" \
    -v "$tmp/token:/run/test-secrets/token:ro" \
    -v "$tmp/api:/run/test-secrets/api:ro" \
    wateaminbox/centrifugo:v6.9.1-redacted -o pipefail -c "$pipeline" \
    wrapper-test "$mode" >/dev/null
  status=$(docker wait "$pipe_container")
  logs=$(docker logs "$pipe_container" 2>&1)
  if [[ $status != "$expected" || $status == 141 || $logs == *"$nats_secret"* ]]; then
    echo "closed $stream pipe changed child status or leaked a secret for $mode" >&2
    exit 1
  fi
done

# signal.Notify catches wrapper SIGPIPE without making the child ignore it.
sigpipe_container="centrifugo-redaction-child-sigpipe-$$"
run_wrapper "$sigpipe_container" sigpipe-default
sigpipe_status=$(docker wait "$sigpipe_container")
if [[ $sigpipe_status != 141 ]]; then
  echo "child inherited an inappropriate SIGPIPE disposition (status $sigpipe_status)" >&2
  exit 1
fi

for signal_case in TERM:42 INT:43 HUP:44; do
  signal=${signal_case%%:*}
  expected=${signal_case##*:}
  signal_lower=$(tr '[:upper:]' '[:lower:]' <<<"$signal")
  signal_container="centrifugo-redaction-${signal_lower}-$$"
  run_wrapper "$signal_container" signals
  ready=false
  for _ in $(seq 1 50); do
    if docker logs "$signal_container" 2>&1 | rg -q '^ready$'; then
      ready=true
      break
    fi
    sleep 0.1
  done
  [[ $ready == true ]] || { echo "signal test child did not start" >&2; exit 1; }
  docker kill --signal "$signal" "$signal_container" >/dev/null
  status=$(docker wait "$signal_container")
  logs=$(docker logs "$signal_container" 2>&1)
  if [[ $status != "$expected" || $logs != *"forwarded-$signal"* ]]; then
    echo "wrapper did not forward $signal or preserve status $expected" >&2
    exit 1
  fi
done

# Static process/config audit: only the wrapper constructs the credential URL;
# Compose carries file paths, never secret values or shell command substitutions.
if rg -n 'CENTRIFUGO_BROKER_NATS_URL|cat .*(nats_service_password)' \
  "$ROOT/docker-compose.yml" "$ROOT/compose.production.yml"; then
  echo "Compose reconstructs or logs the credential-bearing NATS URL" >&2
  exit 1
fi
rg -q 'bytes\.Equal\(w\.pending' "$ROOT/infrastructure/centrifugo/entrypoint/main.go"
entrypoint_source="$ROOT/infrastructure/centrifugo/entrypoint/main.go"
notify_line=$(rg -n 'signal\.Notify\(signals, syscall\.SIGTERM, syscall\.SIGINT, syscall\.SIGHUP\)' "$entrypoint_source" | cut -d: -f1)
start_line=$(rg -n 'waitErr, startErr := executeCommand\(command, signals\)' "$entrypoint_source" | cut -d: -f1)
((notify_line < start_line))
sigpipe_line=$(rg -n 'signal\.Notify\(sigpipe, syscall\.SIGPIPE\)' "$entrypoint_source" | cut -d: -f1)
run_line=$(rg -n 'os\.Exit\(run\(\)\)' "$entrypoint_source" | cut -d: -f1)
((sigpipe_line < run_line))
if rg -n 'fmt\..*CENTRIFUGO_BROKER_NATS_URL|log\..*CENTRIFUGO_BROKER_NATS_URL' \
  "$ROOT/infrastructure/centrifugo/entrypoint/main.go"; then
  echo "entrypoint logs the credential-bearing NATS URL" >&2
  exit 1
fi

DEV_RUNTIME_DIR="$tmp/runtime" docker compose --env-file "$ROOT/.env.example" \
  -f "$ROOT/docker-compose.yml" config --format json >"$tmp/dev-compose.json"
docker compose --env-file "$ROOT/.env.production.example" \
  -f "$ROOT/compose.production.yml" config --format json >"$tmp/prod-compose.json"
jq -e '
  .services.centrifugo.entrypoint == ["/usr/local/bin/centrifugo-secret-entrypoint"] and
  .services.centrifugo.command == ["centrifugo", "--config=/centrifugo/config.json"] and
  .services.centrifugo.environment.CENTRIFUGO_NATS_PASSWORD_FILE == "/run/dev-secrets/nats_service_password" and
  .services.centrifugo.healthcheck.test == ["CMD", "wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8000/health"]
' "$tmp/dev-compose.json" >/dev/null
jq -e '
  .services.centrifugo.entrypoint == ["/usr/local/bin/centrifugo-secret-entrypoint"] and
  .services.centrifugo.command == ["centrifugo", "--config=/centrifugo/config.json"] and
  .services.centrifugo.environment.CENTRIFUGO_NATS_PASSWORD_FILE == "/run/secrets/nats_service_password" and
  .services.centrifugo.restart == "unless-stopped" and
  .services.centrifugo.init == true and
  (.services.centrifugo.secrets[] | select(.source == "nats_service_password"))
' "$tmp/prod-compose.json" >/dev/null

for secret in "$nats_secret" "$token_secret" "$api_secret"; do
  if rg -F "$secret" "$tmp/dev-compose.json" "$tmp/prod-compose.json" >/dev/null; then
    echo "rendered Compose contains a test secret" >&2
    exit 1
  fi
done

echo "ok - Centrifugo wrapper redacts live secrets and preserves process semantics"
