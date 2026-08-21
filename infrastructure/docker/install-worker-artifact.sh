#!/bin/sh
set -eu

artifact_source=${WORKER_ARTIFACT_SOURCE:-/opt/wateaminbox/worker/whatsapp-worker}
checksum_source=${WORKER_ARTIFACT_SHA256_FILE:-/opt/wateaminbox/worker/whatsapp-worker.sha256}
artifact_root=${WORKER_ARTIFACT_ROOT:-/var/lib/wateaminbox/worker-artifacts}
version=${WORKER_ARTIFACT_VERSION:-}

fail() {
  printf 'worker artifact installer: %s\n' "$*" >&2
  exit 1
}

validate_version() {
  candidate=$1
  [ "${#candidate}" -le 128 ] || fail 'version exceeds 128 characters'
  case "$candidate" in
    [!A-Za-z0-9]*|*[!A-Za-z0-9._-]*)
      fail 'version must contain only letters, digits, dots, underscores, and hyphens, and start with a letter or digit'
      ;;
  esac
}

validate_installed() {
  installed_version=$1
  required_checksum=${2:-}
  installed_directory=$artifact_root/$installed_version
  installed_binary=$installed_directory/whatsapp-worker
  installed_manifest=$installed_directory/sha256
  [ -d "$installed_directory" ] && [ ! -L "$installed_directory" ] || fail "existing version $installed_version is not a directory"
  [ -f "$installed_binary" ] && [ ! -L "$installed_binary" ] || fail "existing version $installed_version has no regular worker"
  [ -x "$installed_binary" ] || fail "existing version $installed_version worker is not executable"
  [ -f "$installed_manifest" ] && [ ! -L "$installed_manifest" ] || fail "existing version $installed_version has no regular checksum"
  [ "$(wc -c < "$installed_manifest" | tr -d ' ')" = 65 ] || fail "existing version $installed_version checksum is malformed"
  installed_checksum=$(cat "$installed_manifest")
  printf '%s\n' "$installed_checksum" | grep -Eq '^[0-9a-f]{64}$' || fail "existing version $installed_version checksum is malformed"
  [ "$(sha256sum "$installed_binary" | awk '{print $1}')" = "$installed_checksum" ] || fail "installed version $installed_version failed checksum validation"
  [ -z "$required_checksum" ] || [ "$installed_checksum" = "$required_checksum" ] || fail "version $installed_version is already bound to a different checksum"
}

install_directory() {
  install_version=$1
  install_checksum=$2
  install_destination=$artifact_root/$install_version
  if [ -e "$install_destination" ] || [ -L "$install_destination" ]; then
    validate_installed "$install_version" "$install_checksum"
    return 0
  fi

  temporary=$artifact_root/.install-$install_version-$$
  rm -rf "$temporary"
  trap 'rm -rf "$temporary"' EXIT HUP INT TERM
  mkdir "$temporary"
  cp "$artifact_source" "$temporary/whatsapp-worker"
  chmod 0555 "$temporary/whatsapp-worker"
  printf '%s\n' "$install_checksum" > "$temporary/sha256"
  chmod 0444 "$temporary/sha256"
  [ "$(sha256sum "$temporary/whatsapp-worker" | awk '{print $1}')" = "$install_checksum" ] || fail 'staged worker failed checksum validation'
  chmod 0555 "$temporary"
  mv "$temporary" "$install_destination"
  trap - EXIT HUP INT TERM
}

[ -f "$artifact_source" ] && [ ! -L "$artifact_source" ] || fail 'packaged worker is not a regular file'
[ -x "$artifact_source" ] || fail 'packaged worker is not executable'
[ -f "$checksum_source" ] && [ ! -L "$checksum_source" ] || fail 'packaged checksum is not a regular file'
[ "$(wc -c < "$checksum_source" | tr -d ' ')" = 65 ] || fail 'packaged checksum must be exactly 64 lowercase hex characters plus a newline'
expected_checksum=$(cat "$checksum_source")
printf '%s\n' "$expected_checksum" | grep -Eq '^[0-9a-f]{64}$' || fail 'packaged checksum is malformed'
actual_checksum=$(sha256sum "$artifact_source" | awk '{print $1}')
[ "$actual_checksum" = "$expected_checksum" ] || fail 'packaged worker does not match its checksum'

# Mutable production image tags are safe by default: artifact identity derives
# from bytes, not from APP_IMAGE_TAG. An explicit reviewed release label remains
# supported and is still immutable once installed.
if [ -z "$version" ]; then
  version=sha256-$expected_checksum
fi
validate_version "$version"

mkdir -p "$artifact_root"
[ -d "$artifact_root" ] && [ ! -L "$artifact_root" ] || fail 'artifact root is not a directory'
install_directory "$version" "$expected_checksum"

# The first staged worker becomes an immutable compatibility bootstrap. Later
# worker-only releases never rewrite it, so changing WORKER_IMAGE_TAG leaves the
# orchestrator container model and its fallback binary path unchanged.
if [ ! -e "$artifact_root/bootstrap" ] && [ ! -L "$artifact_root/bootstrap" ]; then
  install_directory bootstrap "$expected_checksum"
else
  validate_installed bootstrap ""
fi

printf 'worker artifact installer: installed version %s (%s)\n' "$version" "$expected_checksum"
