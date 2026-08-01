#!/bin/bash
# Supervise the development API watcher and keep its database schema current.
#
# bun --watch can remain alive but stop serving after a transient import error.
# This process detects both dead and wedged watchers, applies pending migrations
# before every launch, and owns the only API watcher on the configured port.

set -u

ROOT_DIR=${SUPERVISOR_ROOT_DIR:?SUPERVISOR_ROOT_DIR is required}
LOG_FILE=${SUPERVISOR_LOG:?SUPERVISOR_LOG is required}
PORT=${SUPERVISOR_PORT:-4445}
HEALTH_URL=${SUPERVISOR_HEALTH_URL:-http://localhost:${PORT}/api/health}
PID_FILE=${SUPERVISOR_PID_FILE:-${ROOT_DIR}/logs/api-supervisor.pid}
LOCK_DIR=${PID_FILE}.lock
START_CMD=${SUPERVISOR_START_CMD:-}
MIGRATE_CMD=${SUPERVISOR_MIGRATE_CMD:-bun run db:migrate}
MIGRATIONS_DIR=${SUPERVISOR_MIGRATIONS_DIR:-${ROOT_DIR}/packages/database/src/migrations}
BOOT_GRACE=${SUPERVISOR_BOOT_GRACE:-10}
PROBE_INTERVAL=${SUPERVISOR_PROBE_INTERVAL:-10}
MAX_FAILURES=${SUPERVISOR_MAX_FAILURES:-3}
MIGRATION_RETRY_INTERVAL=${SUPERVISOR_MIGRATION_RETRY_INTERVAL:-10}

if [ -z "$START_CMD" ]; then
	START_CMD="cd '${ROOT_DIR}/apps/api' && exec bun run --watch src/index.ts"
fi

api_pid=""
shutting_down=false
applied_migration_signature=""

log() {
	printf '[api-supervisor] %s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "$*" >>"$LOG_FILE"
}

# Sleep in a child so INT/TERM interrupts wait immediately.
snooze() {
	sleep "$1" &
	wait $! 2>/dev/null || true
}

listener_pids() {
	lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true
}

clear_port_listeners() {
	local pids
	pids=$(listener_pids)
	[ -z "$pids" ] && return 0
	while IFS= read -r pid; do
		[ -n "$pid" ] && kill -9 "$pid" 2>/dev/null || true
	done <<<"$pids"
	log "cleared stale listener(s) on port $PORT: $(echo "$pids" | tr '\n' ' ')"
}

acquire_lock() {
	local attempt existing
	for attempt in 1 2 3; do
		if mkdir "$LOCK_DIR" 2>/dev/null; then
			echo $$ >"$LOCK_DIR/pid"
			echo $$ >"$PID_FILE"
			return 0
		fi

		existing=$(cat "$LOCK_DIR/pid" 2>/dev/null || true)
		if [ -n "$existing" ] && kill -0 "$existing" 2>/dev/null; then
			log "ERROR supervisor pid $existing already owns port $PORT; refusing to compete"
			return 1
		fi

		# A new owner may be between mkdir and writing its PID. Give it one
		# short grace period before treating the lock as stale.
		if [ -z "$existing" ] && [ "$attempt" -eq 1 ]; then
			snooze 0.2
			continue
		fi

		# The lock owner is gone. Only one contender can recreate the lock.
		rm -rf "$LOCK_DIR"
		rm -f "$PID_FILE"
	done

	log "ERROR could not acquire supervisor lock for port $PORT"
	return 1
}

release_lock() {
	rm -f "$PID_FILE"
	rm -rf "$LOCK_DIR"
}

migration_signature() {
	if [ ! -d "$MIGRATIONS_DIR" ]; then
		printf 'missing\n'
		return
	fi
	find "$MIGRATIONS_DIR" -type f -name '*.ts' -print |
		LC_ALL=C sort |
		while IFS= read -r migration; do shasum "$migration"; done |
		shasum |
		awk '{print $1}'
}

run_migrations() {
	if (cd "$ROOT_DIR" && eval "$MIGRATE_CMD") >>"$LOG_FILE" 2>&1; then
		applied_migration_signature=$(migration_signature)
		log "migrations up to date"
		return 0
	fi

	log "ERROR database migration failed; API launch is blocked to prevent schema/code mismatch"
	return 1
}

wait_for_migrations() {
	while ! run_migrations; do
		[ "$shutting_down" = true ] && return 1
		log "retrying migrations in ${MIGRATION_RETRY_INTERVAL}s"
		snooze "$MIGRATION_RETRY_INTERVAL"
	done
}

start_api() {
	# dev-start clears ports before launching us. This also recovers an orphaned
	# watcher left behind if a previous supervisor exited unexpectedly.
	clear_port_listeners
	# START_CMD should exec its long-running process so api_pid is authoritative.
	(eval "$START_CMD") >>"$LOG_FILE" 2>&1 &
	api_pid=$!
	log "watcher started (pid $api_pid)"
}

stop_api() {
	if [ -n "$api_pid" ] && kill -0 "$api_pid" 2>/dev/null; then
		kill "$api_pid" 2>/dev/null || true
		local waited=0
		while [ "$waited" -lt 5 ] && kill -0 "$api_pid" 2>/dev/null; do
			sleep 1
			waited=$((waited + 1))
		done
		kill -9 "$api_pid" 2>/dev/null || true
		wait "$api_pid" 2>/dev/null || true
	fi
	api_pid=""
}

launch_api() {
	wait_for_migrations || return 1
	[ "$shutting_down" = true ] && return 1
	start_api
	snooze "$BOOT_GRACE"
}

restart_api() {
	log "restarting watcher: $1"
	stop_api
	launch_api
}

shutdown() {
	shutting_down=true
	log "supervisor stopping"
	stop_api
	# Remove a listener only if our watcher failed to terminate cleanly and left
	# a descendant behind. The supervisor lock guarantees it is not a peer.
	clear_port_listeners
	release_lock
	exit 0
}
trap shutdown INT TERM

main() {
	mkdir -p "$(dirname "$PID_FILE")" "$(dirname "$LOG_FILE")"
	touch "$LOG_FILE"
	acquire_lock || exit 1
	log "supervisor started (pid $$, port $PORT)"

	launch_api || shutdown

	local failures=0 current_migration_signature
	while true; do
		current_migration_signature=$(migration_signature)
		if [ "$current_migration_signature" != "$applied_migration_signature" ]; then
			# A watcher may already have hot-reloaded code that depends on this
			# migration. Stop serving until migration succeeds, then relaunch.
			log "migration source changed; migrating before API reload continues"
			stop_api
			launch_api
			failures=0
		elif ! kill -0 "$api_pid" 2>/dev/null; then
			restart_api "watcher process died"
			failures=0
		elif curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then
			failures=0
		else
			failures=$((failures + 1))
			if [ "$failures" -ge "$MAX_FAILURES" ]; then
				restart_api "unresponsive after $failures health probes"
				failures=0
			fi
		fi
		snooze "$PROBE_INTERVAL"
	done
}

main
