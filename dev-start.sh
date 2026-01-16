#!/bin/bash
set -e

# =============================================================================
# WhatsApp Web - Development Environment Startup Script
# =============================================================================
#
# USAGE:
#   ./dev-start.sh                    # Run in foreground (logs to terminal)
#   ./dev-start.sh --skip-docker      # Run without starting Docker services
#   ./dev-start.sh &                  # Run in background
#   ./dev-start.sh > dev-server.log 2>&1 &   # Run in background with logs to file
#
# MONITORING LOGS:
#   tail -f dev-server.log            # Follow logs in real-time
#   tail -100 dev-server.log          # View last 100 lines
#
# STOPPING:
#   - If running in foreground: Press Ctrl+C
#   - If running in background: kill %1  OR  pkill -f dev-start.sh
#
# HOT-RELOAD:
#   - Frontend (Vite), API (Bun), Marketing (Astro): Auto-reload on file changes
#   - Go services (Orchestrator, WhatsApp worker): Auto-rebuild via 'air'
#     Note: Existing WhatsApp worker processes won't restart automatically.
#           New workers spawned by orchestrator will use the updated binary.
#
# =============================================================================

# Parse arguments
SKIP_DOCKER=false
for arg in "$@"; do
    case $arg in
        --skip-docker)
            SKIP_DOCKER=true
            shift
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
        kill -9 $pid 2>/dev/null || true
        print_success "  Killed process on port $port (PID: $pid)"
    fi
}

# Clean up app ports before starting
cleanup_ports() {
    print_status "Cleaning up app ports..."
    
    # App ports
    kill_port 4444   # Frontend
    kill_port 4445   # API
    kill_port 4446   # Marketing
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
    until docker exec whatsapp-web-postgres pg_isready -U postgres &> /dev/null; do
        sleep 1
    done
    print_success "  PostgreSQL is ready"
    
    # Wait for NATS (check if port 4448 is accepting connections)
    print_status "  Waiting for NATS..."
    until nc -z localhost 4448 &> /dev/null; do
        sleep 1
    done
    print_success "  NATS is ready"
    
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
    (cd services/whatsapp && go build -o whatsapp-worker main.go)
    print_success "  WhatsApp worker built"
    
    # Build orchestrator (create tmp dir for air)
    mkdir -p services/orchestrator/tmp
    (cd services/orchestrator && go build -o tmp/orchestrator main.go)
    print_success "  Orchestrator built"
}

# Load environment variables from .env file
load_env() {
    if [ -f .env ]; then
        print_status "Loading environment variables from .env..."
        set -a  # automatically export all variables
        source .env
        set +a
        print_success "Environment variables loaded"
    else
        print_warning ".env file not found, using defaults"
    fi
}

# Start development servers
start_dev_servers() {
    echo ""
    print_success "Starting development servers..."
    echo ""
    
    # Get absolute path for more robust directory handling
    local ROOT_DIR="$(pwd)"
    
    # Start API server using subshell with cd to avoid --cwd issues
    # This is more robust when other processes run in the same directory
    print_status "  Starting API server..."
    (cd "$ROOT_DIR/apps/api" && bun run --watch src/index.ts) &
    PIDS+=($!)
    sleep 2
    
    # Start Frontend using subshell for isolation
    print_status "  Starting Frontend..."
    (cd "$ROOT_DIR/apps/web" && bun run dev) &
    PIDS+=($!)
    sleep 3
    
    # Start Marketing site using subshell for isolation
    print_status "  Starting Marketing site..."
    (cd "$ROOT_DIR/apps/marketing" && bun run dev) &
    PIDS+=($!)
    sleep 1
    
    # Start WhatsApp worker watcher (rebuilds binary on changes)
    print_status "  Starting WhatsApp worker watcher (hot-reload)..."
    (cd services/whatsapp && air) &
    PIDS+=($!)
    sleep 1
    
    # Start Orchestrator with hot-reload
    print_status "  Starting Orchestrator (hot-reload)..."
    WHATSAPP_BINARY_PATH="$(pwd)/services/whatsapp/whatsapp-worker"
    export WHATSAPP_BINARY_PATH
    (cd services/orchestrator && air) &
    PIDS+=($!)
    
    echo ""
    echo -e "${GREEN}Service URLs:${NC}"
    echo -e "  Frontend:    ${BLUE}http://localhost:4444${NC}"
    echo -e "  API:         ${BLUE}http://localhost:4445${NC}"
    echo -e "  Marketing:   ${BLUE}http://localhost:4446${NC}"
    echo -e "  Orchestrator:${BLUE}http://localhost:8080${NC}"
    echo ""
    echo -e "${GREEN}Infrastructure:${NC}"
    echo -e "  PostgreSQL:  ${BLUE}localhost:4447${NC}"
    echo -e "  NATS:        ${BLUE}localhost:4448${NC} (monitoring: ${BLUE}localhost:8222${NC})"
    echo -e "  Meilisearch: ${BLUE}http://localhost:4449${NC}"
    echo -e "  MinIO:       ${BLUE}http://localhost:4450${NC} (console: ${BLUE}http://localhost:9001${NC})"
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
    
    check_prerequisites
    load_env
    cleanup_ports
    if [ "$SKIP_DOCKER" = false ]; then
        start_docker_services
    else
        print_status "Skipping Docker services (--skip-docker flag)"
    fi
    install_dependencies
    run_migrations
    build_go_services
    start_dev_servers
}

main
