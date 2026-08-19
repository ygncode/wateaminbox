#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

# The WhatsApp module owns the repository's integration-tagged Go suite.
# Running every module with this tag merely repeats unit/timing tests and makes
# unrelated orchestrator signal tests susceptible to scheduler timing noise.
echo "Running WhatsApp Go integration tests"
cd "$ROOT/services/whatsapp"
exec go test -tags=integration -count=1 -timeout 20m ./...
