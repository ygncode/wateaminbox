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
    "whatsapp-web_postgres_data"
    "whatsapp-web_nats_data"
    "whatsapp-web_meilisearch_data"
    "whatsapp-web_minio_data"
)

# Container names
CONTAINERS=(
    "whatsapp-web-postgres"
    "whatsapp-web-nats"
    "whatsapp-web-meilisearch"
    "whatsapp-web-minio"
    "whatsapp-web-minio-init"
)

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
            docker rm "$container" >/dev/null 2>&1 || true
            print_success "Removed: $container"
        fi
    done
}

# Remove volumes
remove_volumes() {
    print_status "Removing volumes..."

    for volume in "${VOLUMES[@]}"; do
        if docker volume ls -q | grep -q "^${volume}$"; then
            docker volume rm "$volume" >/dev/null 2>&1 || true
            print_success "Removed: $volume"
        else
            print_warning "Volume not found: $volume"
        fi
    done
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
    echo "  - NATS JetStream data"
    echo "  - Meilisearch indexes"
    echo "  - MinIO stored files (media)"
    echo ""

    read -p "Are you sure you want to continue? (y/N): " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        print_status "Aborted."
        exit 0
    fi

    echo ""
    stop_containers
    echo ""
    remove_containers
    echo ""
    remove_volumes

    echo ""
    echo -e "${GREEN}════════════════════════════════════════${NC}"
    print_success "All data has been cleaned!"
    echo -e "${GREEN}════════════════════════════════════════${NC}"
    echo ""
    print_status "To restart fresh, run:"
    echo "  docker-compose up -d"
    echo "  bun run db:migrate"
    echo ""
}

main
