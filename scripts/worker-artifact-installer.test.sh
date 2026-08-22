#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
INSTALLER="$ROOT/infrastructure/docker/install-worker-artifact.sh"
TMP=$(mktemp -d)
trap 'chmod -R u+w "$TMP" 2>/dev/null || true; rm -rf "$TMP"' EXIT

SOURCE="$TMP/source"
CHECKSUM="$TMP/source.sha256"
ARTIFACTS="$TMP/artifacts"
printf '#!/bin/sh\necho worker-v1\n' > "$SOURCE"
chmod 0555 "$SOURCE"
sha256sum "$SOURCE" | awk '{print $1}' > "$CHECKSUM"

install_version() {
  WORKER_ARTIFACT_SOURCE="$SOURCE" \
  WORKER_ARTIFACT_SHA256_FILE="$CHECKSUM" \
  WORKER_ARTIFACT_ROOT="$ARTIFACTS" \
  WORKER_ARTIFACT_VERSION="$1" \
    "$INSTALLER"
}

install_version release-2026.08.02
install_version release-2026.08.02
[ -x "$ARTIFACTS/release-2026.08.02/whatsapp-worker" ]
expected=$(cat "$CHECKSUM")
[ "$(cat "$ARTIFACTS/release-2026.08.02/sha256")" = "$expected" ]
[ "$(sha256sum "$ARTIFACTS/release-2026.08.02/whatsapp-worker" | awk '{print $1}')" = "$expected" ]
echo 'ok - installs an immutable version and accepts an identical retry'

chmod u+w "$SOURCE"
printf '#!/bin/sh\necho worker-v2\n' > "$SOURCE"
chmod 0555 "$SOURCE"
sha256sum "$SOURCE" | awk '{print $1}' > "$CHECKSUM"
if install_version release-2026.08.02; then
  echo 'installer overwrote an existing version with different content' >&2
  exit 1
fi
[ "$(sha256sum "$ARTIFACTS/release-2026.08.02/whatsapp-worker" | awk '{print $1}')" = "$expected" ]
echo 'ok - refuses to rebind a version to a different hash'

for unsafe in '../escape' '/absolute' 'contains/slash' '.hidden' 'white space' $'line\nbreak'; do
  if install_version "$unsafe"; then
    echo "installer accepted unsafe version: $unsafe" >&2
    exit 1
  fi
done
[ ! -e "$TMP/escape" ]
echo 'ok - rejects unsafe versions'

# With no explicit immutable label, derive identity from bytes. The bootstrap
# remains bound to the first installed worker and is never rewritten.
install_version ""
derived="sha256-$(cat "$CHECKSUM")"
[ -x "$ARTIFACTS/$derived/whatsapp-worker" ]
[ "$(cat "$ARTIFACTS/bootstrap/sha256")" = "$expected" ]
[ "$(sha256sum "$ARTIFACTS/bootstrap/whatsapp-worker" | awk '{print $1}')" = "$expected" ]
echo 'ok - mutable image tags derive immutable versions without moving bootstrap'

printf '%064d' 0 > "$CHECKSUM"
if install_version another-release; then
  echo 'installer accepted a checksum without the required newline' >&2
  exit 1
fi
[ ! -e "$ARTIFACTS/another-release" ]
echo 'ok - validates packaged checksum shape before writing'
