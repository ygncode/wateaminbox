#!/bin/bash
set -e

# =============================================================================
# WhatsApp Web - Development Environment Startup Script
# =============================================================================
#
# USAGE:
#   ./dev-start.sh                    # Run services (logs written to logs/ directory)
#   ./dev-start.sh --skip-docker      # Run without starting Docker services
#   ./dev-start.sh &                  # Run in background
#
# MONITORING LOGS:
#   tail -f logs/api.log              # Follow API logs
#   tail -f logs/web.log              # Follow Frontend logs
#   tail -f logs/orchestrator.log     # Follow Orchestrator logs
#   tail -f logs/*.log                # Follow all service logs
#
# STOPPING:
#   - If running in foreground: Press Ctrl+C
#   - If running in background: kill %1  OR  pkill -f dev-start.sh
#
# HOT-RELOAD:
#   - Frontend (Vite), API (Bun): Auto-reload on file changes
#   - Go services (Orchestrator, WhatsApp worker): Auto-rebuild via 'air'
#     Note: Existing WhatsApp worker processes won't restart automatically.
#           New workers spawned by orchestrator will use the updated binary.
#
# =============================================================================

# Parse arguments
SKIP_DOCKER=false
CHECK_WORKER_BOUNDARY=false
DEV_ENV_FILE=${DEV_ENV_FILE:-.env}
DEV_RUNTIME_DIR=${DEV_RUNTIME_DIR:-.dev-runtime}
DEV_HOST_UID=${DEV_HOST_UID:-$(id -u)}
DEV_HOST_GID=${DEV_HOST_GID:-$(id -g)}
export DEV_RUNTIME_DIR DEV_HOST_UID DEV_HOST_GID
for arg in "$@"; do
    case $arg in
        --skip-docker)
            SKIP_DOCKER=true
            ;;
        --check-worker-boundary)
            CHECK_WORKER_BOUNDARY=true
            ;;
    esac
done

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Store PIDs for cleanup
PIDS=()

# Logs directory
LOGS_DIR="$(pwd)/logs"

# Print colored message
print_status() {
    echo -e "${BLUE}[*]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[+]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

print_error() {
    echo -e "${RED}[x]${NC} $1"
}

# Cleanup function
cleanup() {
    echo ""
    print_status "Shutting down services..."
    for pid in "${PIDS[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
        fi
    done
    wait 2>/dev/null || true
    print_success "All services stopped"
    exit 0
}

# Kill process on a specific port
kill_port() {
    local port=$1
    local pid
    pid=$(lsof -ti tcp:"$port" 2>/dev/null || true)
    if [ -n "$pid" ]; then
        while IFS= read -r process_id; do
            kill -9 "$process_id" 2>/dev/null || true
        done <<< "$pid"
        print_success "  Killed process on port $port (PID: $pid)"
    fi
}

# Clean up app ports before starting
cleanup_ports() {
    print_status "Cleaning up app ports..."

    # App ports
    kill_port 4444   # Frontend
    kill_port 4445   # API
    kill_port 8080   # Orchestrator

    print_success "Ports cleaned up"
}

trap cleanup SIGINT SIGTERM

# Check prerequisites
check_prerequisites() {
    print_status "Checking prerequisites..."
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    
    if ! docker info &> /dev/null; then
        print_error "Docker is not running. Please start Docker first."
        exit 1
    fi
    
    # Check bun
    if ! command -v bun &> /dev/null; then
        print_error "Bun is not installed. Please install Bun first: https://bun.sh"
        exit 1
    fi
    
    # Check Go
    if ! command -v go &> /dev/null; then
        print_error "Go is not installed. Please install Go first."
        exit 1
    fi
    
    # Check air (for Go hot-reload)
    if ! command -v air &> /dev/null; then
        print_warning "Air is not installed. Installing for Go hot-reload..."
        go install github.com/air-verse/air@latest
        print_success "Air installed"
    fi
    
    print_success "Prerequisites OK (Docker, Bun, Go, Air installed)"
}

# Start Docker services
start_docker_services() {
    print_status "Starting Docker services..."
    docker-compose up -d
    
    print_status "Waiting for services to be healthy..."
    
    # Wait for PostgreSQL
    print_status "  Waiting for PostgreSQL..."
    until docker exec wateaminbox-postgres pg_isready -U postgres &> /dev/null; do
        sleep 1
    done
    print_success "  PostgreSQL is ready"
    
    # Wait for NATS (check if port 4448 is accepting connections)
    print_status "  Waiting for NATS..."
    until nc -z localhost 4448 &> /dev/null; do
        sleep 1
    done
    print_success "  NATS is ready"

    # Wait for Centrifugo
    print_status "  Waiting for Centrifugo..."
    until curl -fsS http://localhost:4451/health &> /dev/null; do
        sleep 1
    done
    print_success "  Centrifugo is ready"
    
    # Wait for Meilisearch
    print_status "  Waiting for Meilisearch..."
    until curl -s http://localhost:4449/health &> /dev/null; do
        sleep 1
    done
    print_success "  Meilisearch is ready"
    
    # Wait for MinIO
    print_status "  Waiting for MinIO..."
    until curl -s http://localhost:4450/minio/health/live &> /dev/null; do
        sleep 1
    done
    print_success "  MinIO is ready"
    
    print_success "All Docker services are running"
}

# Install dependencies
install_dependencies() {
    print_status "Installing dependencies..."
    bun install
    print_success "Dependencies installed"
}

# Run database migrations
run_migrations() {
    print_status "Running database migrations..."
    bun run db:migrate
    print_success "Database migrations complete"
}

# Build Go services (initial build before air takes over)
build_go_services() {
    print_status "Building Go services..."

    # Build WhatsApp worker
    (cd services/whatsapp && go build -o whatsapp-worker.next main.go && mv whatsapp-worker.next whatsapp-worker)
    print_success "  WhatsApp worker built"

    # Build orchestrator (create tmp dir for air)
    mkdir -p services/orchestrator/tmp
    (cd services/orchestrator && go build -o tmp/orchestrator main.go)
    print_success "  Orchestrator built"
}

# Build internal packages (required for app imports)
build_packages() {
    print_status "Building internal packages..."

    # Build in dependency order: shared -> database -> ui
    print_status "  Building shared package..."
    (cd packages/shared && bun run build)
    print_success "  Shared package built"

    print_status "  Building database package..."
    (cd packages/database && bun run build)
    print_success "  Database package built"

    print_status "  Building UI package..."
    (cd packages/ui && bun run build)
    print_success "  UI package built"

    print_success "All internal packages built"
}

# Ensure the token-signing secrets exist in .env.
#
# The API deliberately ships no default for these: a key committed to this
# repository would let anyone forge tokens against a server that was started
# without NODE_ENV=production. Rather than failing the developer with a
# startup error, generate a random per-machine value once and record it in
# .env, announcing exactly what was added. docker compose reads the same .env,
# so the Centrifugo container stays in sync automatically.
ensure_signing_secrets() {
    local generated=0
    local name

    if [ ! -f "$DEV_ENV_FILE" ]; then
        if [ "$DEV_ENV_FILE" = .env ] && [ -f .env.example ]; then
            print_status "No .env found; creating one from .env.example..."
            cp .env.example "$DEV_ENV_FILE"
        else
            touch "$DEV_ENV_FILE"
        fi
    fi

    for name in JWT_SECRET CENTRIFUGO_TOKEN_HMAC_SECRET; do
        # Present and non-blank? Leave it exactly as the developer set it.
        if grep -qE "^${name}=.*[^[:space:]]" "$DEV_ENV_FILE"; then
            continue
        fi

        local value
        if ! value=$(openssl rand -base64 48 2>/dev/null); then
            print_error "openssl is required to generate ${name}, or set it in .env yourself"
            exit 1
        fi

        # Drop any blank assignment before appending the real one.
        if grep -qE "^${name}=" "$DEV_ENV_FILE"; then
            grep -vE "^${name}=" "$DEV_ENV_FILE" > "${DEV_ENV_FILE}.tmp" && mv "${DEV_ENV_FILE}.tmp" "$DEV_ENV_FILE"
        fi
        printf '\n# Generated by dev-start.sh on %s - local development only.\n%s=%s\n' \
            "$(date -u +%Y-%m-%d)" "$name" "$value" >> "$DEV_ENV_FILE"
        print_warning "Generated a random ${name} and appended it to .env"
        generated=1
    done

    if [ "$generated" -eq 1 ]; then
        print_status "  These are local development secrets. Production supplies its own via Docker secrets."
    fi
}

# Load environment variables from .env file
load_env() {
    ensure_signing_secrets

    print_status "Loading environment variables from .env..."
    set -a  # automatically export all variables
    # shellcheck source=/dev/null
    source "$DEV_ENV_FILE"
    set +a
    print_success "Environment variables loaded"
}

prepare_worker_boundary() {
    set +x
    local name
    for name in POSTGRES_PASSWORD WORKER_POSTGRES_PASSWORD NATS_SERVICE_PASSWORD NATS_WORKER_PASSWORD DATABASE_URL WORKER_DATABASE_URL NATS_URL WORKER_NATS_URL; do
        if [ -z "${!name:-}" ]; then
            print_error "$name is required for the separated development worker boundary"
            exit 1
        fi
    done
    if [ "$POSTGRES_PASSWORD" = "$WORKER_POSTGRES_PASSWORD" ] || [ "$NATS_SERVICE_PASSWORD" = "$NATS_WORKER_PASSWORD" ]; then
        print_error "development manager/service and worker credentials must differ"
        exit 1
    fi
    case "$WORKER_DATABASE_URL" in
        postgresql://wateaminbox_worker:"$WORKER_POSTGRES_PASSWORD"@*) ;;
        *) print_error "WORKER_DATABASE_URL must use the wateaminbox_worker login and WORKER_POSTGRES_PASSWORD"; exit 1 ;;
    esac
    case "$NATS_URL" in
        nats://service:"$NATS_SERVICE_PASSWORD"@*) ;;
        *) print_error "NATS_URL must use the local service credential"; exit 1 ;;
    esac
    case "$WORKER_NATS_URL" in
        nats://worker:"$NATS_WORKER_PASSWORD"@*) ;;
        *) print_error "WORKER_NATS_URL must use the local restricted worker credential"; exit 1 ;;
    esac

    umask 077
    mkdir -p "$DEV_RUNTIME_DIR"
    printf '%s' "$POSTGRES_PASSWORD" > "$DEV_RUNTIME_DIR/postgres_password"
    printf '%s' "$WORKER_POSTGRES_PASSWORD" > "$DEV_RUNTIME_DIR/worker_postgres_password"
    printf '%s' "$NATS_SERVICE_PASSWORD" > "$DEV_RUNTIME_DIR/nats_service_password"
    printf '%s' "$NATS_WORKER_PASSWORD" > "$DEV_RUNTIME_DIR/nats_worker_password"
    NATS_SERVICE_PASSWORD_FILE="$DEV_RUNTIME_DIR/nats_service_password" \
        NATS_WORKER_PASSWORD_FILE="$DEV_RUNTIME_DIR/nats_worker_password" \
        NATS_CONFIG_OUTPUT="$DEV_RUNTIME_DIR/nats.conf" \
        ./infrastructure/nats/render-config.sh
    print_success "Separated development worker credentials and NATS policy prepared"
}

provision_development_worker_role() {
    if [ "$SKIP_DOCKER" = true ]; then
        if [ "${DEV_EXTERNAL_WORKER_BOUNDARY_READY:-false}" != true ]; then
            print_error "--skip-docker requires DEV_EXTERNAL_WORKER_BOUNDARY_READY=true after externally provisioning the restricted DB/NATS boundary"
            exit 1
        fi
        return
    fi
    print_status "Provisioning restricted development worker database role..."
    if ! docker compose --profile setup run --rm worker-credential-provisioner >/dev/null; then
        print_error "worker-role provisioning failed; verify migration 072 and the separated local credentials"
        exit 1
    fi
    print_success "Restricted development worker role provisioned"
}

# Start development servers
start_dev_servers() {
    echo ""
    print_success "Starting development servers..."
    echo ""
    
    # Get absolute path for more robust directory handling
    local ROOT_DIR
    ROOT_DIR="$(pwd)"

    # Keep workspace package outputs synchronized with their source files.
    # Apps import these packages through dist/, so a stale build can otherwise
    # crash a running API after package source changes.
    print_status "  Watching shared package (→ logs/shared.log)..."
    (cd "$ROOT_DIR/packages/shared" && bun run dev) > "$LOGS_DIR/shared.log" 2>&1 &
    PIDS+=($!)

    print_status "  Watching database package (→ logs/database.log)..."
    (cd "$ROOT_DIR/packages/database" && bun run dev) > "$LOGS_DIR/database.log" 2>&1 &
    PIDS+=($!)

    print_status "  Watching UI package (→ logs/ui.log)..."
    (cd "$ROOT_DIR/packages/ui" && bun run dev) > "$LOGS_DIR/ui.log" 2>&1 &
    PIDS+=($!)
    sleep 2
    
    # Start the API under a standalone supervisor. It reapplies pending
    # migrations before every watcher launch and recovers dead/wedged watchers.
    print_status "  Starting API server (→ logs/api.log)..."
    : > "$LOGS_DIR/api.log"
    SUPERVISOR_ROOT_DIR="$ROOT_DIR" \
        SUPERVISOR_LOG="$LOGS_DIR/api.log" \
        "$ROOT_DIR/scripts/api-supervisor.sh" &
    PIDS+=($!)
    sleep 2

    # Start Frontend using subshell for isolation
    print_status "  Starting Frontend (→ logs/web.log)..."
    (cd "$ROOT_DIR/apps/web" && bun run dev) > "$LOGS_DIR/web.log" 2>&1 &
    PIDS+=($!)
    sleep 3

    # Start WhatsApp worker watcher (rebuilds binary on changes)
    print_status "  Starting WhatsApp worker watcher (→ logs/whatsapp-worker.log)..."
    (cd services/whatsapp && air) > "$LOGS_DIR/whatsapp-worker.log" 2>&1 &
    PIDS+=($!)
    sleep 1

    # Start Orchestrator with hot-reload
    print_status "  Starting Orchestrator (→ logs/orchestrator.log)..."
    WHATSAPP_BINARY_PATH="$(pwd)/services/whatsapp/whatsapp-worker"
    export WHATSAPP_BINARY_PATH
    (cd services/orchestrator && air) > "$LOGS_DIR/orchestrator.log" 2>&1 &
    PIDS+=($!)
    
    echo ""
    echo -e "${GREEN}Service URLs:${NC}"
    echo -e "  Frontend:    ${BLUE}http://localhost:4444${NC}"
    echo -e "  API:         ${BLUE}http://localhost:4445${NC}"
    echo -e "  Orchestrator:${BLUE}http://localhost:8080${NC}"
    echo ""
    echo -e "${GREEN}Infrastructure:${NC}"
    echo -e "  PostgreSQL:  ${BLUE}localhost:4447${NC}"
    echo -e "  NATS:        ${BLUE}localhost:4448${NC} (monitoring: ${BLUE}localhost:8222${NC})"
    echo -e "  Centrifugo:  ${BLUE}http://localhost:4451${NC}"
    echo -e "  Meilisearch: ${BLUE}http://localhost:4449${NC}"
    echo -e "  MinIO:       ${BLUE}http://localhost:4450${NC} (console: ${BLUE}http://localhost:9001${NC})"
    echo ""
    echo -e "${GREEN}View logs:${NC}"
    echo -e "  tail -f logs/shared.log       ${BLUE}# Shared package${NC}"
    echo -e "  tail -f logs/database.log     ${BLUE}# Database package${NC}"
    echo -e "  tail -f logs/ui.log           ${BLUE}# UI package${NC}"
    echo -e "  tail -f logs/api.log          ${BLUE}# API only${NC}"
    echo -e "  tail -f logs/web.log          ${BLUE}# Frontend only${NC}"
    echo -e "  tail -f logs/orchestrator.log ${BLUE}# Orchestrator only${NC}"
    echo -e "  tail -f logs/*.log            ${BLUE}# All services${NC}"
    echo ""
    print_success "All services started!"
    print_status "Press Ctrl+C to stop all services"
    echo ""
    
    # Wait for any process to exit
    wait
}

# Main
main() {
    echo ""
    echo -e "${GREEN}WhatsApp Web - Development Environment${NC}"
    echo "========================================"
    echo ""
    
    if [ "$CHECK_WORKER_BOUNDARY" = true ]; then
        if [ ! -f "$DEV_ENV_FILE" ]; then
            print_error "worker-boundary check file not found: $DEV_ENV_FILE"
            exit 1
        fi
        set -a
        # shellcheck source=/dev/null
        source "$DEV_ENV_FILE"
        set +a
        prepare_worker_boundary
        print_success "Development worker-boundary contract is valid"
        return
    fi

    check_prerequisites
    load_env
    prepare_worker_boundary
    mkdir -p "$LOGS_DIR"
    cleanup_ports
    if [ "$SKIP_DOCKER" = false ]; then
        start_docker_services
    else
        print_status "Skipping Docker services (--skip-docker flag)"
    fi
    install_dependencies
    run_migrations
    provision_development_worker_role
    build_go_services
    build_packages
    start_dev_servers
}

main
