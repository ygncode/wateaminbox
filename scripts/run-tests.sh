#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

run() {
  local name=$1
  shift
  echo "==> $name"
  "$@"
}

run "API unit tests" bash -c "cd '$ROOT/apps/api' && bun test"
run "Web unit tests" bash -c "cd '$ROOT/apps/web' && bun test"
run "Shared Go tests" bash -c "cd '$ROOT/services/shared' && go test -short -timeout 5m ./..."
run "Orchestrator Go tests" bash -c "cd '$ROOT/services/orchestrator' && go test -short -timeout 5m ./..."
run "WhatsApp Go tests" bash -c "cd '$ROOT/services/whatsapp' && go test -short -timeout 5m ./..."
