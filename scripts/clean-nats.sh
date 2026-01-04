#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Stream names
STREAM_COMMANDS="WHATSAPP_COMMANDS"
STREAM_EVENTS="WHATSAPP_EVENTS"

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

# Check if NATS is running
check_nats_running() {
    print_status "Checking if NATS is running..."

    if ! nc -z localhost 4222 2>/dev/null; then
        print_error "NATS is not running on port 4222"
        print_status "Start NATS with: docker-compose up -d nats"
        exit 1
    fi

    print_success "NATS is running"
}

# Purge a specific stream
purge_stream() {
    local stream=$1
    print_status "Purging stream: $stream"

    local response
    response=$(curl -s -X POST "http://localhost:8222/jsz?purge=$stream" 2>&1)

    if echo "$response" | grep -q "error"; then
        print_error "Failed to purge $stream"
        echo "$response"
        return 1
    fi

    print_success "Purged: $stream"
}

# Main
main() {
    echo ""
    echo -e "${GREEN}NATS JetStream Cleanup${NC}"
    echo "======================"
    echo ""

    check_nats_running

    echo ""
    print_warning "This will purge all messages from:"
    echo "  - $STREAM_COMMANDS"
    echo "  - $STREAM_EVENTS"
    echo ""

    # Purge streams
    purge_stream "$STREAM_COMMANDS"
    purge_stream "$STREAM_EVENTS"

    echo ""
    print_success "NATS streams cleaned successfully"
    echo ""
}

main
