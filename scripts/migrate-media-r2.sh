#!/usr/bin/env bash
set -euo pipefail

# Non-destructive MinIO -> R2 copy and verification. Credentials stay in the
# operator-managed rclone configuration; this script never reads or writes them.
# No command in this file deletes source or destination objects.

usage() {
	cat <<'EOF'
Usage: migrate-media-r2.sh copy|verify|verify-full [report-directory]

Required environment:
  MIGRATION_SOURCE_REMOTE   preconfigured rclone MinIO remote (for example minio-source:)
  MIGRATION_DEST_REMOTE     preconfigured rclone R2 remote (for example r2-destination:)

Optional environment:
  MIGRATION_BUCKET          must be whatsapp-media (default: whatsapp-media)

verify compares total object count/bytes and performs a one-way size check.
verify-full additionally downloads both sides and compares content hashes; use
it when the transfer size and maintenance window make that practical.
EOF
}

mode=${1:-}
report_dir=${2:-./migration-reports}
bucket=${MIGRATION_BUCKET:-whatsapp-media}
source_remote=${MIGRATION_SOURCE_REMOTE:-}
destination_remote=${MIGRATION_DEST_REMOTE:-}

case "$mode" in
copy | verify | verify-full) ;;
*)
	usage >&2
	exit 2
	;;
esac

if [[ -z "$source_remote" || -z "$destination_remote" ]]; then
	echo "Both MIGRATION_SOURCE_REMOTE and MIGRATION_DEST_REMOTE are required" >&2
	exit 2
fi
if [[ "$bucket" != "whatsapp-media" ]]; then
	echo "Refusing unexpected destination bucket: $bucket" >&2
	exit 2
fi

command -v rclone >/dev/null || {
	echo "rclone is required" >&2
	exit 127
}
command -v jq >/dev/null || {
	echo "jq is required" >&2
	exit 127
}

source_path="${source_remote%:}:$bucket"
destination_path="${destination_remote%:}:$bucket"
if [[ "$source_path" == "$destination_path" ]]; then
	echo "Source and destination must be different remotes" >&2
	exit 2
fi

mkdir -p "$report_dir"
umask 077
stamp=$(date -u +%Y%m%dT%H%M%SZ)
report="$report_dir/media-r2-$stamp"
mkdir "$report"
printf '%s\n' "$source_path" >"$report/source.txt"
printf '%s\n' "$destination_path" >"$report/destination.txt"

if [[ "$mode" == "copy" ]]; then
	# rclone copy is additive/update-only: unlike sync, it never removes objects
	# that exist solely on either side. Re-running resumes an interrupted copy.
	rclone copy "$source_path" "$destination_path" \
		--metadata --fast-list --checkers 16 --transfers 8 \
		--log-file "$report/copy.log" --log-level INFO --stats 30s
fi

rclone size "$source_path" --json >"$report/source-size.json"
rclone size "$destination_path" --json >"$report/destination-size.json"
source_count=$(jq -r '.count' "$report/source-size.json")
source_bytes=$(jq -r '.bytes' "$report/source-size.json")
destination_count=$(jq -r '.count' "$report/destination-size.json")
destination_bytes=$(jq -r '.bytes' "$report/destination-size.json")

printf 'source:      %s objects, %s bytes\n' "$source_count" "$source_bytes"
printf 'destination: %s objects, %s bytes\n' "$destination_count" "$destination_bytes"
if [[ "$mode" == "copy" ]]; then
	if [[ "$source_count" != "$destination_count" || "$source_bytes" != "$destination_bytes" ]]; then
		echo "Copy pass completed while inventories differ; repeat after pausing writers, then run verify" >&2
	else
		echo "Copy pass totals currently match; run verify before cutover"
	fi
	echo "Source was not deleted."
	exit 0
fi

if [[ "$source_count" != "$destination_count" || "$source_bytes" != "$destination_bytes" ]]; then
	echo "Inventory totals differ; do not cut over" >&2
	exit 1
fi

check_args=(check "$source_path" "$destination_path" --one-way --combined "$report/check.txt")
if [[ "$mode" == "verify-full" ]]; then
	check_args+=(--download)
else
	check_args+=(--size-only)
fi
rclone "${check_args[@]}"

echo "Verification passed; report: $report"
echo "Source was not deleted. Retain it through the rollback window."
