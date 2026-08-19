#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)

GO_MODULES=(services/shared services/orchestrator services/whatsapp)

echo "Running Go race detection across ${#GO_MODULES[@]} modules"

for mod in "${GO_MODULES[@]}"; do
  echo ""
  echo "==> $mod (-race -count=1)"
  (cd "$ROOT/$mod" && go test -race -count=1 -timeout 10m ./...)
done
