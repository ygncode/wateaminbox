#!/bin/bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
SUPERVISOR="$ROOT_DIR/scripts/api-supervisor.sh"
TMP_DIR=$(mktemp -d)
SUPERVISOR_PID=""
PORT=""

cleanup() {
	if [ -n "$SUPERVISOR_PID" ] && kill -0 "$SUPERVISOR_PID" 2>/dev/null; then
		kill "$SUPERVISOR_PID" 2>/dev/null || true
		wait "$SUPERVISOR_PID" 2>/dev/null || true
	fi
	if [ -n "$PORT" ]; then
		local listeners
		listeners=$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)
		if [ -n "$listeners" ]; then
			while IFS= read -r listener; do
				[ -z "$listener" ] || kill -9 "$listener" 2>/dev/null || true
			done <<<"$listeners"
		fi
	fi
	rm -rf "$TMP_DIR"
}
trap cleanup EXIT

PORT=$(
	python3 - <<'PY'
import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()
PY
)

cat >"$TMP_DIR/server.py" <<'PY'
from http.server import BaseHTTPRequestHandler, HTTPServer
import sys

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/health":
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, *_args):
        pass

HTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
PY

cat >"$TMP_DIR/migrate.sh" <<'SH'
#!/bin/bash
count_file=$1
fail_once_file=$2
count=0
[ ! -f "$count_file" ] || count=$(cat "$count_file")
count=$((count + 1))
echo "$count" > "$count_file"
if [ -f "$fail_once_file" ]; then
    rm -f "$fail_once_file"
    exit 1
fi
SH
chmod +x "$TMP_DIR/migrate.sh"
touch "$TMP_DIR/fail-once"
mkdir -p "$TMP_DIR/migrations"
echo '// initial migration' >"$TMP_DIR/migrations/001.ts"

export SUPERVISOR_ROOT_DIR="$ROOT_DIR"
export SUPERVISOR_LOG="$TMP_DIR/api.log"
export SUPERVISOR_PORT="$PORT"
export SUPERVISOR_HEALTH_URL="http://127.0.0.1:${PORT}/api/health"
export SUPERVISOR_PID_FILE="$TMP_DIR/supervisor.pid"
export SUPERVISOR_START_CMD="exec python3 '$TMP_DIR/server.py' '$PORT'"
export SUPERVISOR_MIGRATE_CMD="'$TMP_DIR/migrate.sh' '$TMP_DIR/migration-count' '$TMP_DIR/fail-once'"
export SUPERVISOR_MIGRATIONS_DIR="$TMP_DIR/migrations"
export SUPERVISOR_BOOT_GRACE=1
export SUPERVISOR_PROBE_INTERVAL=1
export SUPERVISOR_MAX_FAILURES=2
export SUPERVISOR_MIGRATION_RETRY_INTERVAL=1

"$SUPERVISOR" &
SUPERVISOR_PID=$!

wait_for_health() {
	local attempts=0
	until curl -fsS --max-time 1 "$SUPERVISOR_HEALTH_URL" >/dev/null 2>&1; do
		attempts=$((attempts + 1))
		if [ "$attempts" -ge 20 ]; then
			echo "API supervisor test timed out" >&2
			return 1
		fi
		sleep 0.5
	done
}

wait_for_health
[ "$(cat "$TMP_DIR/migration-count")" -ge 2 ]

echo "ok - migration failure blocks launch and is retried"

# A second supervisor must fail without disturbing the owner.
if "$SUPERVISOR"; then
	echo "second supervisor unexpectedly acquired the lock" >&2
	exit 1
fi
wait_for_health
echo "ok - duplicate supervisor is rejected"

# Adding a migration while the watcher is running must migrate and relaunch
# before hot-reloaded code can continue against stale schema.
old_listener=$(lsof -tiTCP:"$PORT" -sTCP:LISTEN)
echo '// added migration' >"$TMP_DIR/migrations/002.ts"
attempts=0
while true; do
	new_listener=$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)
	migration_count=$(cat "$TMP_DIR/migration-count")
	if [ -n "$new_listener" ] && [ "$new_listener" != "$old_listener" ] && [ "$migration_count" -ge 3 ]; then
		break
	fi
	attempts=$((attempts + 1))
	if [ "$attempts" -ge 30 ]; then
		echo "migration source change did not relaunch the watcher" >&2
		exit 1
	fi
	sleep 0.5
done
wait_for_health
echo "ok - migration source changes are applied before relaunch"

old_listener=$new_listener
kill -9 "$old_listener"
attempts=0
while true; do
	new_listener=$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)
	migration_count=$(cat "$TMP_DIR/migration-count")
	if [ -n "$new_listener" ] && [ "$new_listener" != "$old_listener" ] && [ "$migration_count" -ge 4 ]; then
		break
	fi
	attempts=$((attempts + 1))
	if [ "$attempts" -ge 30 ]; then
		echo "supervisor did not restart the dead watcher" >&2
		exit 1
	fi
	sleep 0.5
done
wait_for_health
echo "ok - dead watcher is migrated and restarted"

kill "$SUPERVISOR_PID"
wait "$SUPERVISOR_PID" 2>/dev/null || true
SUPERVISOR_PID=""
sleep 0.5
if lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
	echo "watcher remained after supervisor shutdown" >&2
	exit 1
fi
[ ! -e "$SUPERVISOR_PID_FILE" ]
[ ! -d "${SUPERVISOR_PID_FILE}.lock" ]
echo "ok - shutdown removes watcher and lock"
