#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
COMPOSE_FILE="$ROOT/compose.production.yml"
ENV_FILE="$ROOT/.env.production.example"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

render() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --format json > "$1"
}

render "$TMP/default.json"
jq -e '
  .services["worker-artifact-installer"].image == "wateaminbox/whatsapp-worker-artifact:2026-08-02.1" and
  .services["worker-artifact-installer"].environment.WORKER_ARTIFACT_VERSION == "" and
  .services["worker-artifact-installer"].depends_on.migration.condition == "service_completed_successfully" and
  .services.orchestrator.depends_on["worker-artifact-installer"].condition == "service_completed_successfully" and
  .services.orchestrator.environment.WHATSAPP_BINARY_PATH == "/var/lib/wateaminbox/worker-artifacts/bootstrap/whatsapp-worker" and
  .services.orchestrator.environment.EPHEMERAL_HTTP_BEARER_TOKEN_FILE == "/run/wateaminbox-control/http-bearer-token" and
  .services.orchestrator.environment.ORCHESTRATOR_ROOT_MANAGER_APPROVED == "true" and
  any(.services.orchestrator.tmpfs[]; . == "/run/wateaminbox-control:mode=0700,uid=0,gid=0") and
  .services.orchestrator.environment.WORKER_ARTIFACT_ROOT == "/var/lib/wateaminbox/worker-artifacts" and
  .services.orchestrator.environment.WORKER_DEFAULT_ARTIFACT_VERSION == "bootstrap" and
  any(.services.orchestrator.volumes[]; .target == "/var/lib/wateaminbox/worker-artifacts" and .read_only == true) and
  any(.services["worker-artifact-installer"].volumes[]; .target == "/var/lib/wateaminbox/worker-artifacts" and (.read_only != true))
' "$TMP/default.json" >/dev/null
rg -q 'apk add --no-cache ca-certificates curl ' "$ROOT/services/orchestrator/Dockerfile"
echo 'ok - backward-compatible defaults, exact root-only control path, curl, and read-only artifacts'

WORKER_IMAGE_TAG=worker-2026.08.03 \
WORKER_ARTIFACT_VERSION=worker-build-a1 \
  render "$TMP/independent.json"
jq -e '
  .services["worker-artifact-installer"].image == "wateaminbox/whatsapp-worker-artifact:worker-2026.08.03" and
  .services["worker-artifact-installer"].environment.WORKER_ARTIFACT_VERSION == "worker-build-a1" and
  .services.orchestrator.environment.WORKER_DEFAULT_ARTIFACT_VERSION == "bootstrap" and
  .services.orchestrator.environment.WHATSAPP_BINARY_PATH == "/var/lib/wateaminbox/worker-artifacts/bootstrap/whatsapp-worker"
' "$TMP/independent.json" >/dev/null
jq -S '.services.orchestrator' "$TMP/default.json" > "$TMP/orchestrator-default.json"
jq -S '.services.orchestrator' "$TMP/independent.json" > "$TMP/orchestrator-independent.json"
cmp "$TMP/orchestrator-default.json" "$TMP/orchestrator-independent.json"
echo 'ok - worker-only image/version staging leaves the orchestrator container model unchanged'
