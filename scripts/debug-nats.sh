#!/bin/bash

# NATS Debugging Script
# Usage: ./scripts/debug-nats.sh <command> [options]

set -e

CONTAINER="wateaminbox-nats-box"
NATS_SERVER="nats://nats:4222"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_header() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}"
}

check_container() {
    if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
        echo -e "${RED}Error: NATS Box container is not running.${NC}"
        echo -e "${YELLOW}Start it with: docker compose --profile debug up -d${NC}"
        exit 1
    fi
}

nats_cmd() {
    docker exec -it "$CONTAINER" nats "$@" -s "$NATS_SERVER"
}

nats_cmd_no_tty() {
    docker exec "$CONTAINER" nats "$@" -s "$NATS_SERVER"
}

case "$1" in
    "streams"|"stream")
        check_container
        print_header "JetStream Streams"
        nats_cmd_no_tty stream ls
        ;;

    "stream-info")
        check_container
        STREAM="${2:-WHATSAPP_EVENTS}"
        print_header "Stream Info: $STREAM"
        nats_cmd_no_tty stream info "$STREAM"
        ;;

    "events")
        check_container
        FILTER="${2:-WHATSAPP.events.>}"
        print_header "Subscribing to: $FILTER (Ctrl+C to stop)"
        nats_cmd sub "$FILTER"
        ;;

    "events-company")
        check_container
        if [ -z "$2" ]; then
            echo -e "${RED}Usage: $0 events-company <companyId> [connectionId]${NC}"
            exit 1
        fi
        COMPANY_ID="$2"
        CONN_ID="${3:-*}"
        FILTER="WHATSAPP.events.${COMPANY_ID}.${CONN_ID}.>"
        print_header "Subscribing to: $FILTER (Ctrl+C to stop)"
        nats_cmd sub "$FILTER"
        ;;

    "commands")
        check_container
        print_header "Recent Commands (last 20)"
        nats_cmd_no_tty stream view WHATSAPP_COMMANDS --last 20
        ;;

    "commands-live")
        check_container
        FILTER="${2:-WHATSAPP.commands.>}"
        print_header "Subscribing to commands: $FILTER (Ctrl+C to stop)"
        nats_cmd sub "$FILTER"
        ;;

    "consumers")
        check_container
        STREAM="${2:-WHATSAPP_COMMANDS}"
        print_header "Consumers for: $STREAM"
        nats_cmd_no_tty consumer ls "$STREAM"
        ;;

    "consumer-info")
        check_container
        if [ -z "$2" ] || [ -z "$3" ]; then
            echo -e "${RED}Usage: $0 consumer-info <stream> <consumer-name>${NC}"
            exit 1
        fi
        print_header "Consumer Info: $3 on $2"
        nats_cmd_no_tty consumer info "$2" "$3"
        ;;

    "lag")
        check_container
        print_header "Consumer Lag Report"
        echo -e "\n${GREEN}WHATSAPP_COMMANDS consumers:${NC}"
        nats_cmd_no_tty consumer ls WHATSAPP_COMMANDS 2>/dev/null || echo "No consumers"
        echo -e "\n${GREEN}WHATSAPP_EVENTS consumers:${NC}"
        nats_cmd_no_tty consumer ls WHATSAPP_EVENTS 2>/dev/null || echo "No consumers"
        echo -e "\n${GREEN}WHATSAPP_DOWNLOADS consumers:${NC}"
        nats_cmd_no_tty consumer ls WHATSAPP_DOWNLOADS 2>/dev/null || echo "No consumers"
        ;;

    "publish")
        check_container
        if [ -z "$2" ] || [ -z "$3" ]; then
            echo -e "${RED}Usage: $0 publish <subject> <message>${NC}"
            echo -e "${YELLOW}Example: $0 publish WHATSAPP.test '{\"hello\":\"world\"}'${NC}"
            exit 1
        fi
        print_header "Publishing to: $2"
        echo "$3" | nats_cmd pub "$2"
        echo -e "${GREEN}Message published${NC}"
        ;;

    "request")
        check_container
        if [ -z "$2" ] || [ -z "$3" ]; then
            echo -e "${RED}Usage: $0 request <subject> <message> [timeout]${NC}"
            exit 1
        fi
        TIMEOUT="${4:-5s}"
        print_header "Request to: $2 (timeout: $TIMEOUT)"
        echo "$3" | nats_cmd request "$2" --timeout "$TIMEOUT"
        ;;

    "purge")
        check_container
        STREAM="${2:-WHATSAPP_COMMANDS}"
        print_header "Purging stream: $STREAM"
        echo -e "${YELLOW}Are you sure? This will delete all messages. (y/N)${NC}"
        read -r confirm
        if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
            nats_cmd_no_tty stream purge "$STREAM" -f
            echo -e "${GREEN}Stream purged${NC}"
        else
            echo "Cancelled"
        fi
        ;;

    "health")
        print_header "NATS Health Check"
        echo -e "\n${GREEN}Server Health:${NC}"
        curl -s http://localhost:8222/healthz && echo -e " ${GREEN}OK${NC}" || echo -e " ${RED}FAILED${NC}"

        echo -e "\n${GREEN}JetStream Status:${NC}"
        curl -s http://localhost:8222/jsz | jq -r '.streams // "No streams"' 2>/dev/null || echo "JetStream info unavailable"

        echo -e "\n${GREEN}Connection Count:${NC}"
        curl -s http://localhost:8222/connz | jq -r '.num_connections // 0' 2>/dev/null || echo "Connection info unavailable"
        ;;

    "stats")
        print_header "NATS Server Statistics"
        curl -s http://localhost:8222/varz | jq '{
            server_id: .server_id,
            version: .version,
            uptime: .uptime,
            mem: .mem,
            cpu: .cpu,
            connections: .connections,
            total_connections: .total_connections,
            in_msgs: .in_msgs,
            out_msgs: .out_msgs,
            in_bytes: .in_bytes,
            out_bytes: .out_bytes
        }' 2>/dev/null || echo "Stats unavailable - is NATS running?"
        ;;

    "js-stats")
        check_container
        print_header "JetStream Statistics"
        nats_cmd_no_tty server report jetstream
        ;;

    "trace")
        check_container
        if [ -z "$2" ]; then
            echo -e "${RED}Usage: $0 trace <correlationId>${NC}"
            echo -e "${YELLOW}Subscribes to events and filters by correlationId${NC}"
            exit 1
        fi
        print_header "Tracing correlationId: $2"
        echo -e "${YELLOW}Listening for events... (Ctrl+C to stop)${NC}"
        nats_cmd sub "WHATSAPP.events.>" | grep --line-buffered "$2" || true
        ;;

    "help"|"--help"|"-h"|"")
        echo -e "${GREEN}NATS Debugging Script${NC}"
        echo ""
        echo "Usage: $0 <command> [options]"
        echo ""
        echo "Commands:"
        echo "  streams                    List all JetStream streams"
        echo "  stream-info [stream]       Show stream details (default: WHATSAPP_EVENTS)"
        echo "  events [filter]            Subscribe to events (default: WHATSAPP.events.>)"
        echo "  events-company <id> [conn] Subscribe to events for a specific company"
        echo "  commands                   View recent commands (last 20)"
        echo "  commands-live [filter]     Subscribe to commands in real-time"
        echo "  consumers [stream]         List consumers for a stream"
        echo "  consumer-info <stream> <n> Show consumer details"
        echo "  lag                        Show consumer lag for all streams"
        echo "  publish <subj> <msg>       Publish a test message"
        echo "  request <subj> <msg>       Send request-reply message"
        echo "  purge [stream]             Purge all messages from a stream"
        echo "  health                     Check NATS server health"
        echo "  stats                      Show server statistics"
        echo "  js-stats                   Show JetStream statistics"
        echo "  trace <correlationId>      Filter events by correlationId"
        echo "  help                       Show this help message"
        echo ""
        echo "Examples:"
        echo "  $0 events                           # Watch all events"
        echo "  $0 events-company abc123            # Watch events for company abc123"
        echo "  $0 events-company abc123 conn456    # Watch specific connection"
        echo "  $0 consumer-info WHATSAPP_COMMANDS worker-abc123-conn456"
        echo "  $0 trace corr-1234567890-abcd      # Trace a specific message flow"
        echo ""
        echo -e "${YELLOW}Note: Start nats-box first with: docker compose --profile debug up -d${NC}"
        ;;

    *)
        echo -e "${RED}Unknown command: $1${NC}"
        echo "Run '$0 help' for usage"
        exit 1
        ;;
esac
