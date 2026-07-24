#!/usr/bin/env bash
set -euo pipefail

# Reset WhatsApp test data for one company while preserving its user account,
# company, members, preferences, custom tags, and quick replies.

POSTGRES_CONTAINER=${POSTGRES_CONTAINER:-wateaminbox-postgres}
POSTGRES_USER=${POSTGRES_USER:-postgres}
POSTGRES_DB=${POSTGRES_DB:-wateaminbox}
NATS_URL=${NATS_URL:-nats://localhost:4448}
ORCHESTRATOR_URL=${ORCHESTRATOR_URL:-http://localhost:8080}
MEILISEARCH_URL=${MEILISEARCH_URL:-http://localhost:4449}
MEILISEARCH_API_KEY=${MEILISEARCH_API_KEY:-development_master_key}
S3_ENDPOINT=${S3_ENDPOINT:-http://localhost:4450}
S3_ACCESS_KEY=${S3_ACCESS_KEY:-minioadmin}
S3_SECRET_KEY=${S3_SECRET_KEY:-minioadmin}
S3_BUCKET=${S3_BUCKET:-whatsapp-media}

email=""
requested_company_id=""
assume_yes=false
manager_snapshot=""
temp_files=()

usage() {
  cat <<'EOF'
Usage:
  ./dev-utils/reset-whatsapp-account.sh EMAIL [--company-id UUID] [--yes]

Examples:
  ./dev-utils/reset-whatsapp-account.sh setkyar16@gmail.com
  ./dev-utils/reset-whatsapp-account.sh setkyar16@gmail.com --yes

The reset keeps the login and company, but removes that company's:
  - WhatsApp connections and worker registry rows
  - whatsmeow device/session data
  - imported contacts, messages, reactions, groups, labels, and catalogs
  - pending WhatsApp outbox commands
  - company-scoped NATS events/commands/downloads
  - uploaded WhatsApp media and Meilisearch indexes

If the user belongs to multiple companies, pass --company-id explicitly.

Environment overrides:
  POSTGRES_CONTAINER, POSTGRES_USER, POSTGRES_DB
  NATS_URL, ORCHESTRATOR_URL
  MEILISEARCH_URL, MEILISEARCH_API_KEY
  S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET
EOF
}

log() {
  printf '[reset-whatsapp] %s\n' "$*"
}

warn() {
  printf '[reset-whatsapp] WARNING: %s\n' "$*" >&2
}

fail() {
  printf '[reset-whatsapp] ERROR: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  for file in "${temp_files[@]:-}"; do
    [[ -n "$file" ]] && rm -f "$file"
  done
}
trap cleanup EXIT

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

psql_stdin() {
  docker exec -i "$POSTGRES_CONTAINER" \
    psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X "$@"
}

manager_workers() {
  curl -fsS "$ORCHESTRATOR_URL/workers" 2>/dev/null
}

while (($# > 0)); do
  case "$1" in
    --company-id)
      (($# >= 2)) || fail "--company-id requires a UUID"
      requested_company_id=$2
      shift 2
      ;;
    --yes | -y)
      assume_yes=true
      shift
      ;;
    --help | -h)
      usage
      exit 0
      ;;
    --*)
      fail "Unknown option: $1"
      ;;
    *)
      [[ -z "$email" ]] || fail "Only one email may be supplied"
      email=$1
      shift
      ;;
  esac
done

[[ -n "$email" ]] || {
  usage >&2
  exit 2
}
if [[ -n "$requested_company_id" ]]; then
  [[ "$requested_company_id" =~ ^[0-9a-fA-F-]{36}$ ]] || fail "Invalid company UUID"
fi

require_command docker
require_command curl
require_command jq
require_command nats
require_command mc

docker inspect "$POSTGRES_CONTAINER" >/dev/null 2>&1 ||
  fail "PostgreSQL container is not available: $POSTGRES_CONTAINER"

account_rows=$(
  psql_stdin -At -F $'\t' \
    -v "account_email=$email" \
    -v "requested_company_id=$requested_company_id" <<'SQL'
SELECT c.id::text, c.schema_name, c.name
FROM public.users AS u
JOIN public.company_members AS cm ON cm.user_id = u.id
JOIN public.companies AS c ON c.id = cm.company_id
WHERE lower(u.email) = lower(:'account_email')
  AND (
    NULLIF(:'requested_company_id', '') IS NULL
    OR c.id::text = :'requested_company_id'
  )
ORDER BY c.created_at;
SQL
)

row_count=$(printf '%s\n' "$account_rows" | awk 'NF { count++ } END { print count + 0 }')
if ((row_count == 0)); then
  if [[ -n "$requested_company_id" ]]; then
    fail "No company $requested_company_id belongs to $email"
  fi
  fail "No company found for $email"
fi
if ((row_count > 1)); then
  printf '%s\n' "$account_rows" | awk -F '\t' '{ printf "  %s  %s\n", $1, $3 }' >&2
  fail "The account belongs to multiple companies; rerun with --company-id"
fi

IFS=$'\t' read -r company_id schema_name company_name <<<"$account_rows"
[[ "$company_id" =~ ^[0-9a-fA-F-]{36}$ ]] || fail "Database returned an invalid company UUID"
[[ "$schema_name" =~ ^tenant_[a-zA-Z0-9_]+$ ]] || fail "Unsafe tenant schema name: $schema_name"

# Include tenant rows, persisted worker rows, and stale in-memory manager rows.
database_connection_ids=$(
  psql_stdin -At -v "company_id=$company_id" <<SQL
SELECT id::text FROM ${schema_name}.whatsapp_connections
UNION
SELECT connection_id::text FROM public.worker_registry
WHERE company_id::text = :'company_id';
SQL
)
if manager_snapshot=$(manager_workers); then
  manager_connection_ids=$(jq -r --arg company_id "$company_id" \
    '.workers[]? | select(.company_id == $company_id) | .id' <<<"$manager_snapshot")
else
  manager_connection_ids=""
  warn "Orchestrator status is unavailable at $ORCHESTRATOR_URL"
fi
connection_ids=$(
  printf '%s\n%s\n' "$database_connection_ids" "$manager_connection_ids" |
    awk 'NF' |
    sort -u
)
connection_count=$(printf '%s\n' "$connection_ids" | awk 'NF { count++ } END { print count + 0 }')

log "Account: $email"
log "Company: $company_name ($company_id)"
log "Tenant:  $schema_name"
log "Connections discovered: $connection_count"

if [[ "$assume_yes" != true ]]; then
  printf '\nThis permanently removes the WhatsApp test data listed above.\n'
  printf 'Type the account email to continue: '
  read -r confirmation
  [[ "$confirmation" == "$email" ]] || fail "Confirmation did not match; nothing was changed"
fi

# Ask the orchestrator to stop workers before deleting their session/database
# state. Dead manager entries are harmless and are ignored by the live-PID wait.
if ((connection_count > 0)); then
  while IFS= read -r connection_id; do
    [[ -n "$connection_id" ]] || continue
    [[ "$connection_id" =~ ^[0-9a-fA-F-]{36}$ ]] || fail "Invalid connection UUID: $connection_id"
    payload=$(jq -nc \
      --arg company_id "$company_id" \
      --arg connection_id "$connection_id" \
      '{type:"kill", company_id:$company_id, connection_id:$connection_id, reason:"development account reset"}')
    nats --server "$NATS_URL" pub \
      "WHATSAPP.commands.$company_id.$connection_id" "$payload" >/dev/null
    log "Requested worker stop: $connection_id"
  done <<<"$connection_ids"

  for _ in $(seq 1 30); do
    live_workers=0
    if manager_snapshot=$(manager_workers); then
      while IFS= read -r worker_pid; do
        [[ -n "$worker_pid" ]] || continue
        if kill -0 "$worker_pid" 2>/dev/null; then
          live_workers=$((live_workers + 1))
        fi
      done < <(
        jq -r --arg company_id "$company_id" \
          '.workers[]? | select(.company_id == $company_id) | .pid // empty' \
          <<<"$manager_snapshot"
      )
    fi
    ((live_workers == 0)) && break
    sleep 1
  done
  ((live_workers == 0)) || fail "A company worker is still running; aborting before database cleanup"
fi

connection_csv=$(printf '%s\n' "$connection_ids" | awk 'NF' | paste -sd, -)

# Keep user/company configuration and non-WhatsApp productivity settings. The
# explicit table list makes the preservation boundary clear and reviewable.
psql_stdin -q \
  -v "company_id=$company_id" \
  -v "connection_ids=$connection_csv" <<SQL
BEGIN;

DELETE FROM ${schema_name}.message_reactions;
DELETE FROM ${schema_name}.messages;
DELETE FROM ${schema_name}.conversation_states;
DELETE FROM ${schema_name}.contact_assignments;
DELETE FROM ${schema_name}.contact_notes_private;
DELETE FROM ${schema_name}.contact_notes_shared;
DELETE FROM ${schema_name}.contact_tags;
DELETE FROM ${schema_name}.group_participants;
DELETE FROM ${schema_name}.groups;
DELETE FROM ${schema_name}.contacts;
DELETE FROM ${schema_name}.catalog_products;
DELETE FROM ${schema_name}.whatsapp_catalogs;
DELETE FROM ${schema_name}.whatsapp_label_associations;
DELETE FROM ${schema_name}.whatsapp_labels;
DELETE FROM ${schema_name}.status_updates;
DELETE FROM ${schema_name}.whatsmeow_lid_mappings;
DELETE FROM ${schema_name}.nats_outbox;
DELETE FROM ${schema_name}.whatsapp_connections;

CREATE TEMP TABLE reset_connection_ids (id text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO reset_connection_ids (id)
SELECT unnest(string_to_array(:'connection_ids', ','))
WHERE :'connection_ids' <> '';

DO \$reset\$
DECLARE
  session_table record;
BEGIN
  FOR session_table IN
    SELECT DISTINCT table_name
    FROM information_schema.columns
    WHERE table_schema = 'whatsapp_sessions'
      AND column_name = 'connection_id'
  LOOP
    EXECUTE format(
      'DELETE FROM whatsapp_sessions.%I WHERE connection_id::text IN (SELECT id FROM reset_connection_ids)',
      session_table.table_name
    );
  END LOOP;
END
\$reset\$;

DELETE FROM public.worker_registry
WHERE company_id::text = :'company_id';

UPDATE public.company_stats
SET total_messages = 0,
    total_contacts = 0,
    last_message_at = NULL,
    updated_at = now()
WHERE company_id::text = :'company_id';

COMMIT;
SQL
log "PostgreSQL WhatsApp data removed"

purge_stream_subject() {
  local stream=$1
  local subject=$2
  if nats --server "$NATS_URL" stream info "$stream" >/dev/null 2>&1; then
    nats --server "$NATS_URL" stream purge "$stream" \
      --subject="$subject" --force >/dev/null
  fi
}

purge_stream_subject WHATSAPP_COMMANDS "WHATSAPP.commands.$company_id.>"
purge_stream_subject WHATSAPP_EVENTS "WHATSAPP.events.$company_id.>"
purge_stream_subject WHATSAPP_DOWNLOADS "WHATSAPP.download.$company_id.>"
log "Company-scoped NATS messages purged"

if mc alias set reset-whatsapp "$S3_ENDPOINT" "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null 2>&1; then
  media_prefix="reset-whatsapp/$S3_BUCKET/media/$company_id/"
  media_count=$(mc ls --recursive "$media_prefix" 2>/dev/null | wc -l | tr -d ' ')
  mc rm --recursive --force "$media_prefix" >/dev/null 2>&1 || true
  log "Media removed: $media_count object(s)"
else
  warn "Could not connect to object storage at $S3_ENDPOINT; media was not removed"
fi

for index_name in \
  "messages_${company_id//-/_}" \
  "contacts_${company_id//-/_}"; do
  response_file=$(mktemp)
  temp_files+=("$response_file")
  http_status=$(curl -sS -o "$response_file" -w '%{http_code}' \
    -X DELETE "$MEILISEARCH_URL/indexes/$index_name" \
    -H "Authorization: Bearer $MEILISEARCH_API_KEY" || true)
  case "$http_status" in
    202)
      log "Meilisearch index deletion queued: $index_name"
      ;;
    404)
      ;;
    *)
      warn "Could not delete Meilisearch index $index_name (HTTP ${http_status:-unavailable})"
      ;;
  esac
done

verification=$(
  psql_stdin -At -F $'\t' <<SQL
SELECT
  (SELECT count(*) FROM ${schema_name}.whatsapp_connections),
  (SELECT count(*) FROM ${schema_name}.contacts),
  (SELECT count(*) FROM ${schema_name}.messages),
  (SELECT count(*) FROM public.worker_registry WHERE company_id = '${company_id}'::uuid);
SQL
)
IFS=$'\t' read -r remaining_connections remaining_contacts remaining_messages remaining_workers <<<"$verification"
if [[ "$remaining_connections" != 0 || "$remaining_contacts" != 0 || "$remaining_messages" != 0 || "$remaining_workers" != 0 ]]; then
  fail "Verification failed: connections=$remaining_connections contacts=$remaining_contacts messages=$remaining_messages workers=$remaining_workers"
fi

if manager_snapshot=$(manager_workers); then
  stale_manager_count=$(jq -r --arg company_id "$company_id" \
    '[.workers[]? | select(.company_id == $company_id)] | length' <<<"$manager_snapshot")
  if ((stale_manager_count > 0)); then
    warn "$stale_manager_count dead in-memory orchestrator reference(s) remain until its next restart; they do not block pairing"
  fi
fi

log "Reset complete. Refresh the app and create a new WhatsApp connection."
