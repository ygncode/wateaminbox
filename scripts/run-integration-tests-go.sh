#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)

GO_MODULES=(services/shared services/orchestrator services/whatsapp)

echo "Running Go integration tests across ${#GO_MODULES[@]} modules"

for mod in "${GO_MODULES[@]}"; do
  echo ""
  echo "==> $mod"
  (cd "$ROOT/$mod" && go test -tags=integration -timeout 20m ./...)
done
