#!/usr/bin/env bash

# Test runner script for WhatsApp Web monorepo
# Usage: ./scripts/run-tests.sh [options]
#
# Options:
#   --all           Run all tests (default if no flags specified)
#   --backend       Run backend API tests (bun)
#   --orchestrator  Run orchestrator Go tests
#   --whatsapp      Run whatsapp Go tests
#   --e2e           Run Playwright E2E tests
#   --verbose       Show full test output instead of summary
#   --help          Show this help message

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get project root directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Default values
RUN_BACKEND=false
RUN_ORCHESTRATOR=false
RUN_WHATSAPP=false
RUN_E2E=false
VERBOSE=false
NO_FLAGS=true

# Results tracking
RESULTS_NAMES=""
RESULTS_VALUES=""
FAILED=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --all)
            RUN_BACKEND=true
            RUN_ORCHESTRATOR=true
            RUN_WHATSAPP=true
            RUN_E2E=true
            NO_FLAGS=false
            shift
            ;;
        --backend)
            RUN_BACKEND=true
            NO_FLAGS=false
            shift
            ;;
        --orchestrator)
            RUN_ORCHESTRATOR=true
            NO_FLAGS=false
            shift
            ;;
        --whatsapp)
            RUN_WHATSAPP=true
            NO_FLAGS=false
            shift
            ;;
        --e2e)
            RUN_E2E=true
            NO_FLAGS=false
            shift
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        --help|-h)
            echo "Test runner script for WhatsApp Web monorepo"
            echo ""
            echo "Usage: ./scripts/run-tests.sh [options]"
            echo ""
            echo "Options:"
            echo "  --all           Run all tests (default if no flags specified)"
            echo "  --backend       Run backend API tests (bun)"
            echo "  --orchestrator  Run orchestrator Go tests"
            echo "  --whatsapp      Run whatsapp Go tests"
            echo "  --e2e           Run Playwright E2E tests"
            echo "  --verbose       Show full test output instead of summary"
            echo "  --help          Show this help message"
            echo ""
            echo "Examples:"
            echo "  ./scripts/run-tests.sh                    # Run all tests"
            echo "  ./scripts/run-tests.sh --backend          # Run only backend tests"
            echo "  ./scripts/run-tests.sh --backend --e2e    # Run backend and E2E tests"
            echo "  ./scripts/run-tests.sh --all --verbose    # Run all tests with full output"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            echo "Use --help to see available options"
            exit 1
            ;;
    esac
done

# If no flags specified, run all tests
if [ "$NO_FLAGS" = true ]; then
    RUN_BACKEND=true
    RUN_ORCHESTRATOR=true
    RUN_WHATSAPP=true
    RUN_E2E=true
fi

# Helper function to add result
add_result() {
    local name=$1
    local value=$2
    if [ -z "$RESULTS_NAMES" ]; then
        RESULTS_NAMES="$name"
        RESULTS_VALUES="$value"
    else
        RESULTS_NAMES="$RESULTS_NAMES|$name"
        RESULTS_VALUES="$RESULTS_VALUES|$value"
    fi
}

# Helper function to run tests
run_test() {
    local name=$1
    local cmd=$2
    local dir=$3

    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}Running: ${name}${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    local start_time=$(date +%s)
    local exit_code=0

    if [ "$VERBOSE" = true ]; then
        if [ -n "$dir" ]; then
            (cd "$dir" && eval "$cmd") || exit_code=$?
        else
            eval "$cmd" || exit_code=$?
        fi
    else
        local temp_file=$(mktemp)
        if [ -n "$dir" ]; then
            (cd "$dir" && eval "$cmd" > "$temp_file" 2>&1) || exit_code=$?
        else
            eval "$cmd" > "$temp_file" 2>&1 || exit_code=$?
        fi

        if [ $exit_code -ne 0 ]; then
            echo -e "${RED}Test output:${NC}"
            cat "$temp_file"
        fi
        rm -f "$temp_file"
    fi

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    if [ $exit_code -eq 0 ]; then
        add_result "$name" "PASS:${duration}"
        echo -e "${GREEN}✓ ${name} passed (${duration}s)${NC}"
    else
        add_result "$name" "FAIL:${duration}"
        echo -e "${RED}✗ ${name} failed (${duration}s)${NC}"
        FAILED=true
    fi
    echo ""

    return 0
}

# Print header
echo ""
echo -e "${YELLOW}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${YELLOW}║              WhatsApp Web Test Runner                      ║${NC}"
echo -e "${YELLOW}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Show what will run
echo -e "Tests to run:"
[ "$RUN_BACKEND" = true ] && echo -e "  ${GREEN}✓${NC} Backend (API)"
[ "$RUN_ORCHESTRATOR" = true ] && echo -e "  ${GREEN}✓${NC} Orchestrator (Go)"
[ "$RUN_WHATSAPP" = true ] && echo -e "  ${GREEN}✓${NC} WhatsApp (Go)"
[ "$RUN_E2E" = true ] && echo -e "  ${GREEN}✓${NC} E2E (Playwright)"
echo ""

# Track overall start time
OVERALL_START=$(date +%s)

# Run selected tests
if [ "$RUN_BACKEND" = true ]; then
    run_test "Backend API Tests" "bun test" "$PROJECT_ROOT/apps/api"
fi

if [ "$RUN_ORCHESTRATOR" = true ]; then
    run_test "Orchestrator Go Tests" "go test ./..." "$PROJECT_ROOT/services/orchestrator"
fi

if [ "$RUN_WHATSAPP" = true ]; then
    run_test "WhatsApp Go Tests" "go test ./..." "$PROJECT_ROOT/services/whatsapp"
fi

if [ "$RUN_E2E" = true ]; then
    run_test "E2E Playwright Tests" "bunx playwright test" "$PROJECT_ROOT/apps/web"
fi

# Calculate total time
OVERALL_END=$(date +%s)
TOTAL_TIME=$((OVERALL_END - OVERALL_START))

# Print summary
echo -e "${YELLOW}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${YELLOW}║                      Test Summary                          ║${NC}"
echo -e "${YELLOW}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Parse and display results
IFS='|' read -ra NAMES <<< "$RESULTS_NAMES"
IFS='|' read -ra VALUES <<< "$RESULTS_VALUES"

for i in "${!NAMES[@]}"; do
    name="${NAMES[$i]}"
    value="${VALUES[$i]}"
    status="${value%%:*}"
    duration="${value##*:}"

    if [ "$status" = "PASS" ]; then
        echo -e "  ${name}: ${GREEN}PASS${NC} (${duration}s)"
    else
        echo -e "  ${name}: ${RED}FAIL${NC} (${duration}s)"
    fi
done

echo ""
echo -e "Total time: ${TOTAL_TIME}s"
echo ""

if [ "$FAILED" = true ]; then
    echo -e "${RED}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║                    SOME TESTS FAILED                       ║${NC}"
    echo -e "${RED}╚════════════════════════════════════════════════════════════╝${NC}"
    exit 1
else
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                    ALL TESTS PASSED                        ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
    exit 0
fi
