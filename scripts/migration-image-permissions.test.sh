#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
IMAGE_TAG="wateaminbox/migration-permission-test:$$"

cleanup() {
  docker image rm "$IMAGE_TAG" >/dev/null 2>&1 || true
}
trap cleanup EXIT

BUILDX_NO_DEFAULT_ATTESTATIONS=1 docker build \
  --target migration \
  --file "$ROOT/apps/api/Dockerfile" \
  --tag "$IMAGE_TAG" \
  "$ROOT"

docker run --rm --network none --entrypoint /bin/sh "$IMAGE_TAG" -ec '
  test "$(id -un)" = bun
  test -r /app/package.json
  test ! -w /app/package.json
  test "$(stat -c %a /app/package.json)" = 444
  bun -e '\''JSON.parse(await Bun.file("/app/package.json").text())'\''
'

echo "ok - migration user can read an immutable root package manifest"
