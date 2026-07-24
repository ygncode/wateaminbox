#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Docker volume names (from docker-compose.yml)
VOLUMES=(
    "wateaminbox_postgres_data"
    "wateaminbox_nats_data"
    "wateaminbox_meilisearch_data"
    "wateaminbox_minio_data"
)

# Container names
CONTAINERS=(
    "wateaminbox-postgres"
    "wateaminbox-nats"
    "wateaminbox-meilisearch"
    "wateaminbox-minio"
    "wateaminbox-minio-init"
)

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

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

# Kill any running dev processes
kill_dev_processes() {
    print_status "Stopping any running dev processes..."

    # Kill orchestrator and whatsapp worker processes
    pkill -f "services/orchestrator" 2>/dev/null && print_success "Stopped orchestrator" || true
    pkill -f "services/whatsapp" 2>/dev/null && print_success "Stopped whatsapp workers" || true
    pkill -f "bun.*dev" 2>/dev/null && print_success "Stopped bun dev server" || true

    # Give processes time to clean up
    sleep 1
}

# Stop containers
stop_containers() {
    print_status "Stopping containers..."

    for container in "${CONTAINERS[@]}"; do
        if docker ps -q -f name="$container" | grep -q .; then
            docker stop "$container" >/dev/null 2>&1 || true
            print_success "Stopped: $container"
        fi
    done
}

# Remove containers
remove_containers() {
    print_status "Removing containers..."

    for container in "${CONTAINERS[@]}"; do
        if docker ps -aq -f name="$container" | grep -q .; then
            docker rm -f "$container" >/dev/null 2>&1 || true
            print_success "Removed: $container"
        fi
    done
}

# Remove volumes
remove_volumes() {
    print_status "Removing volumes..."

    for volume in "${VOLUMES[@]}"; do
        if docker volume ls -q | grep -q "^${volume}$"; then
            docker volume rm -f "$volume" >/dev/null 2>&1 || true
            print_success "Removed: $volume"
        else
            print_warning "Volume not found: $volume"
        fi
    done
}

# Start fresh containers and run migrations
start_fresh() {
    print_status "Starting fresh containers..."
    cd "$PROJECT_DIR"
    docker-compose up -d

    # Wait for postgres to be ready
    print_status "Waiting for PostgreSQL to be ready..."
    sleep 3
    for i in {1..30}; do
        if docker exec wateaminbox-postgres pg_isready -U postgres >/dev/null 2>&1; then
            print_success "PostgreSQL is ready"
            break
        fi
        sleep 1
    done

    # Run migrations
    print_status "Running database migrations..."
    bun run db:migrate
    print_success "Migrations completed"
}

# Main
main() {
    echo ""
    echo -e "${RED}╔═══════════════════════════════════════╗${NC}"
    echo -e "${RED}║     FULL DATABASE CLEANUP SCRIPT      ║${NC}"
    echo -e "${RED}╚═══════════════════════════════════════╝${NC}"
    echo ""

    print_warning "This will DELETE ALL DATA including:"
    echo "  - PostgreSQL database (all tenants, users, messages)"
    echo "  - NATS JetStream data (clears stale message queues)"
    echo "  - Meilisearch indexes"
    echo "  - MinIO stored files (media)"
    echo "  - Stop any running dev processes"
    echo ""

    read -p "Are you sure you want to continue? (y/N): " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        print_status "Aborted."
        exit 0
    fi

    echo ""
    kill_dev_processes
    echo ""
    stop_containers
    echo ""
    remove_containers
    echo ""
    remove_volumes

    echo ""
    read -p "Do you want to start fresh containers and run migrations? (y/N): " restart
    if [[ "$restart" =~ ^[Yy]$ ]]; then
        echo ""
        start_fresh
    fi

    echo ""
    echo -e "${GREEN}════════════════════════════════════════${NC}"
    print_success "All data has been cleaned!"
    echo -e "${GREEN}════════════════════════════════════════${NC}"
    echo ""

    if [[ ! "$restart" =~ ^[Yy]$ ]]; then
        print_status "To restart fresh, run:"
        echo "  docker-compose up -d"
        echo "  bun run db:migrate"
        echo ""
    fi
}

main
