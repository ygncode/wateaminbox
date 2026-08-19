#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)

# Recursive discovery of all TypeScript integration test files.
# This is the single entry point for CI and local use.
# Portable: works with macOS Bash 3 (no mapfile, no process substitution for arrays).

files=()
while IFS= read -r f; do
  files+=("$f")
done <<EOF
$(git -C "$ROOT" ls-files --cached --others --exclude-standard \
    'packages/database/src/*.integration.test.ts' \
    'apps/api/src/*.integration.test.ts' \
  | LC_ALL=C sort)
EOF

if [ "${#files[@]}" -eq 0 ]; then
  echo "FATAL: zero integration test files discovered" >&2
  exit 1
fi

echo "Discovered ${#files[@]} TypeScript integration test files:"
for f in "${files[@]}"; do
  echo "  $f"
done
echo ""

export RUN_DB_INTEGRATION=1
export RATE_LIMIT_ENABLED="${RATE_LIMIT_ENABLED:-false}"
export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/wateaminbox}"

# Synthetic secrets so env validation does not abort the test process.
# These are NOT real credentials — they exist only to satisfy module-load
# validation and are never used for signing or authentication in tests.
export JWT_SECRET="${JWT_SECRET:-integration-test-only-not-a-secret-at-least-32-chars}"
export CENTRIFUGO_TOKEN_HMAC_SECRET="${CENTRIFUGO_TOKEN_HMAC_SECRET:-integration-test-only-realtime-not-a-secret-32-chars}"

# Run each file in its own Bun process. Several integration suites intentionally
# cache membership/configuration at module scope; combining every file in one
# process leaks those caches between otherwise isolated fixtures. Sequential
# processes also prevent independent suites from mutating shared public tables
# concurrently while retaining recursive discovery.
for f in "${files[@]}"; do
  echo "==> $f"
  bun test "$ROOT/$f"
done
