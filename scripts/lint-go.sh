#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
MODULES=(services/shared services/orchestrator services/whatsapp)

# All Go files under services are first-party.
unformatted=$(cd "$ROOT" && find services -type f -name '*.go' -print0 | xargs -0 gofmt -l | sort -u)
if [[ -n "$unformatted" ]]; then
  echo "The following Go files need gofmt:" >&2
  echo "$unformatted" >&2
  exit 1
fi

for module in "${MODULES[@]}"; do
  echo "go vet ./$module/..."
  (cd "$ROOT/$module" && go vet ./...)
done
