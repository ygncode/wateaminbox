#!/bin/bash

# =============================================================================
# Improvement Loop - Autonomous AI-driven code improvement workflow
# =============================================================================
#
# Usage: ./improvement-loop.sh [OPTIONS]
#
# Options:
#   --max-cycles N    Stop after N improvement cycles (default: unlimited)
#   --dry-run         Print commands without executing
#   --focus "area"    Override default focus area
#   --resume          Resume from saved state in .loop/state.json
#
# Tools:
#   gyolo - Gemini yolo (identifies improvements, reviews)
#   cyolo - Claude yolo (creates specs, tasks, PRs)
#   zyolo - Zai/Claude Code yolo (implements tasks)
#
# =============================================================================

set -e

# Load .env file from project root
if [ -f "$(pwd)/.env" ]; then
    set -a
    source "$(pwd)/.env"
    set +a
fi

# Configuration
PROJECT_DIR="$(pwd)"
LOOP_DIR="$PROJECT_DIR/.loop"
COOLDOWN_SECONDS=300  # 5 minutes between cycles
MAX_CYCLES=-1         # -1 = unlimited
DRY_RUN=false
FOCUS_AREA=""         # Empty = auto-detect each cycle
FOCUS_HISTORY_FILE="$LOOP_DIR/focus-history.md"
STATE_FILE="$LOOP_DIR/state.json"
RESUME_MODE=false

# Track state
CURRENT_CYCLE=0
PREVIOUS_BRANCH="main"
CYCLE_LETTERS=({a..z})
RESUME_PHASE=0
RESUME_SLUG=""

# Parse arguments
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --max-cycles)
            MAX_CYCLES="$2"
            shift 2
        ;;
        --dry-run)
            DRY_RUN=true
            shift
        ;;
        --focus)
            FOCUS_AREA="$2"
            shift 2
        ;;
        --resume)
            RESUME_MODE=true
            shift
        ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--max-cycles N] [--dry-run] [--focus \"area\"] [--resume]"
            exit 1
        ;;
    esac
done

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# All logs go to stderr so they don't pollute stdout (used for return values)
log_info() { echo -e "${BLUE}[INFO]${NC} $1" >&2; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1" >&2; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1" >&2; }
log_error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }
log_step() { echo -e "${PURPLE}[STEP]${NC} $1" >&2; }
log_agent() { echo -e "${CYAN}[$1]${NC} $2" >&2; }

# Run command (for git, etc. - not for AI tools)
run_cmd() {
    if [ "$DRY_RUN" = true ]; then
        echo "[DRY-RUN] $*"
    else
        "$@"
    fi
}

# Run Claude with prompt from file (output to stderr so it doesn't pollute return values)
run_claude() {
    local model=$1
    local prompt_file=$2

    if [ "$DRY_RUN" = true ]; then
        echo "[DRY-RUN] claude --dangerously-skip-permissions --model $model -p <prompt>" >&2
        return 0
    fi

    claude --dangerously-skip-permissions --model "$model" -p "$(cat "$prompt_file")" >&2
}

# Run Claude with zai backend (output to stderr)
run_zyolo() {
    local prompt_file=$1

    if [ "$DRY_RUN" = true ]; then
        echo "[DRY-RUN] zyolo -p <prompt>" >&2
        return 0
    fi

    if [ -z "$ZAI_AUTH_TOKEN" ]; then
        echo "Error: ZAI_AUTH_TOKEN environment variable not set" >&2
        exit 1
    fi

    ANTHROPIC_BASE_URL="https://api.z.ai/api/anthropic" \
    ANTHROPIC_AUTH_TOKEN="$ZAI_AUTH_TOKEN" \
    claude --dangerously-skip-permissions -p "$(cat "$prompt_file")" >&2
}

# Run Gemini with prompt from file (output to stderr)
run_gemini() {
    local prompt_file=$1

    if [ "$DRY_RUN" = true ]; then
        echo "[DRY-RUN] gemini --yolo <prompt>" >&2
        return 0
    fi

    gemini --yolo "$(cat "$prompt_file")" >&2
}

# Initialize loop directory
init_loop_dir() {
    mkdir -p "$LOOP_DIR"
    log_info "Loop directory: $LOOP_DIR"
}

# Save state to JSON file
save_state() {
    local cycle=$1
    local letter=$2
    local slug=$3
    local phase=$4
    local phase_name=$5
    local prev_branch=$6

    cat > "$STATE_FILE" << EOF
{
  "current_cycle": ${cycle},
  "cycle_letter": "${letter}",
  "slug": "${slug}",
  "phase": ${phase},
  "phase_name": "${phase_name}",
  "previous_branch": "${prev_branch}",
  "last_updated": "$(date -Iseconds)"
}
EOF
    log_info "State saved: cycle=${letter}, phase=${phase} (${phase_name}), slug=${slug}"
}

# Load state from JSON file
load_state() {
    if [ ! -f "$STATE_FILE" ]; then
        log_error "No state file found at $STATE_FILE"
        exit 1
    fi

    # Parse JSON (simple parsing without jq dependency)
    CURRENT_CYCLE=$(grep '"current_cycle"' "$STATE_FILE" | grep -o '[0-9]*')
    RESUME_SLUG=$(grep '"slug"' "$STATE_FILE" | cut -d'"' -f4)
    RESUME_PHASE=$(grep '"phase"' "$STATE_FILE" | grep -o '[0-9]*' | head -1)
    PREVIOUS_BRANCH=$(grep '"previous_branch"' "$STATE_FILE" | cut -d'"' -f4)

    local cycle_letter
    cycle_letter=$(grep '"cycle_letter"' "$STATE_FILE" | cut -d'"' -f4)
    local phase_name
    phase_name=$(grep '"phase_name"' "$STATE_FILE" | cut -d'"' -f4)

    log_success "State loaded: cycle=${cycle_letter}, phase=${RESUME_PHASE} (${phase_name}), slug=${RESUME_SLUG}"
}

# Get cycle letter (a, b, c, ...)
get_cycle_letter() {
    local idx=$1
    if [ $idx -lt 26 ]; then
        echo "${CYCLE_LETTERS[$idx]}"
    else
        local first=$((idx / 26 - 1))
        local second=$((idx % 26))
        echo "${CYCLE_LETTERS[$first]}${CYCLE_LETTERS[$second]}"
    fi
}

# =============================================================================
# PHASE 0: Determine Focus Area (cyolo/Claude)
# =============================================================================
phase_determine_focus() {
    local cycle_letter=$1
    log_step "Phase 0: Determining focus area with Claude..."

    local focus_file="$LOOP_DIR/focus-${cycle_letter}.md"
    local prompt_file="$LOOP_DIR/.prompt-focus-${cycle_letter}.txt"

    # Initialize focus history if it doesn't exist
    if [ ! -f "$FOCUS_HISTORY_FILE" ]; then
        cat > "$FOCUS_HISTORY_FILE" << 'EOF'
# Focus Area History

Tracks which areas have been focused on to ensure variety.

EOF
    fi

    local focus_history
    focus_history=$(tail -20 "$FOCUS_HISTORY_FILE" 2>/dev/null || echo "No history yet")

    cat > "$prompt_file" << EOF
You are analyzing a WhatsApp Web business messaging platform to determine where to focus improvement efforts.

PROJECT STRUCTURE:
- services/whatsapp/ - Go WhatsApp client using whatsmeow (message sending, receiving, contact sync)
- services/orchestrator/ - Go service managing WhatsApp worker lifecycle
- apps/api/ - Hono + Bun backend API (REST endpoints, WebSocket, auth)
- apps/web/ - React + Vite frontend (chat UI, team management)
- packages/database/ - Kysely database client & migrations

PREVIOUS FOCUS AREAS (avoid repeating recently):
${focus_history}

YOUR TASK:
1. Analyze the codebase to identify the MOST impactful area to improve
2. Consider these aspects:
   - WhatsApp flow (contact sync, profile sync, message handling, connection stability)
   - Error handling and recovery
   - Performance bottlenecks
   - Test coverage gaps
   - Code quality issues
   - Security concerns
   - User experience improvements

3. Choose ONE specific focus area that:
   - Has high impact potential
   - Has NOT been focused on recently (check history above)
   - Is actionable in a single improvement cycle

4. Write your decision to: ${focus_file}

FORMAT for ${focus_file}:
---
focus: <kebab-case-focus-area>
priority: high|medium|low
rationale: <one line explanation>
---

# Focus Area: <Title>

## Why This Area
<2-3 sentences explaining why this is the most important area to focus on>

## What To Look For
- <specific issue or improvement opportunity 1>
- <specific issue or improvement opportunity 2>
- <specific issue or improvement opportunity 3>

## Components To Analyze
- <file or module 1>
- <file or module 2>

## Expected Outcomes
- <what success looks like>

IMPORTANT: Write the file now. Be strategic and specific.
EOF

    run_claude "sonnet" "$prompt_file"
    rm -f "$prompt_file"

    if [ ! -f "$focus_file" ]; then
        log_error "Focus file was not created: $focus_file"
        echo "whatsapp-stability"
        return
    fi

    local focus
    focus=$(grep -E "^focus:" "$focus_file" | head -1 | cut -d: -f2 | tr -d ' ')
    if [ -z "$focus" ]; then
        focus="general-improvement"
        log_warn "Could not extract focus, using default: $focus"
    fi

    echo "- Cycle $cycle_letter: $focus ($(date '+%Y-%m-%d %H:%M'))" >> "$FOCUS_HISTORY_FILE"

    log_success "Focus area determined: $focus"
    echo "$focus"
}

# =============================================================================
# PHASE 1: Identify Improvements (gyolo/Gemini)
# =============================================================================
phase_identify_improvements() {
    local cycle_letter=$1
    local focus_area=$2
    log_step "Phase 1: Identifying improvements with Gemini..."

    local requirements_file="$LOOP_DIR/requirements-${cycle_letter}.md"
    local focus_file="$LOOP_DIR/focus-${cycle_letter}.md"
    local prompt_file="$LOOP_DIR/.prompt-requirements-${cycle_letter}.txt"

    local focus_context
    focus_context=$(cat "$focus_file" 2>/dev/null || echo "No additional context available.")

    cat > "$prompt_file" << EOF
You are analyzing a WhatsApp Web business messaging platform codebase.

FOCUS AREA: ${focus_area}

FOCUS CONTEXT (read for more details):
${focus_context}

YOUR TASK:
1. Analyze the codebase structure, especially:
   - services/whatsapp/ (Go WhatsApp client)
   - services/orchestrator/ (Go service manager)
   - apps/api/ (Hono backend)
   - apps/web/ (React frontend)

2. Identify ONE specific, actionable improvement that would enhance:
   - Code quality
   - Reliability/stability
   - Performance
   - Error handling
   - User experience
   - Test coverage

3. Generate a descriptive slug (kebab-case, 2-4 words) for this improvement.
   Examples: 'contact-sync-retry', 'message-queue-reliability', 'connection-recovery'

4. Write a detailed requirements document to: ${requirements_file}

FORMAT for ${requirements_file}:
---
slug: <your-generated-slug>
priority: high|medium|low
type: bugfix|feature|refactor|performance|reliability
---

# <Title of Improvement>

## Problem Statement
<What issue exists currently?>

## Proposed Solution
<High-level approach to fix it>

## Affected Components
- <list files/modules that need changes>

## Success Criteria
- <measurable outcomes>

## Risks & Considerations
- <potential issues to watch for>

IMPORTANT: Write the file now. Be specific and actionable.
EOF

    run_gemini "$prompt_file"
    rm -f "$prompt_file"

    if [ ! -f "$requirements_file" ]; then
        log_error "Requirements file was not created: $requirements_file"
        return 1
    fi

    local slug
    slug=$(grep -E "^slug:" "$requirements_file" | head -1 | cut -d: -f2 | tr -d ' ')
    if [ -z "$slug" ]; then
        slug="improvement-${cycle_letter}"
        log_warn "Could not extract slug, using default: $slug"
    fi

    echo "$slug"
}

# =============================================================================
# PHASE 2: Create Specifications (cyolo/Claude Opus)
# =============================================================================
phase_create_specs() {
    local cycle_letter=$1
    local slug=$2
    log_step "Phase 2: Creating specifications with Claude Opus..."

    local requirements_file="$LOOP_DIR/requirements-${cycle_letter}.md"
    local specs_file="$LOOP_DIR/specs-${slug}.md"
    local prompt_file="$LOOP_DIR/.prompt-specs-${slug}.txt"

    cat > "$prompt_file" << EOF
You are a senior software architect creating detailed technical specifications.

READ: ${requirements_file}

YOUR TASK:
Create a detailed technical specification document at: ${specs_file}

The spec should include:

# Technical Specification: <Title>

## Overview
<Brief summary of what we're building/fixing>

## Architecture Changes
<Diagrams or descriptions of architectural changes if any>

## Implementation Details

### Component 1: <Name>
- File: <path>
- Changes:
  - <specific change 1>
  - <specific change 2>
- New functions/methods:
  - functionName(params): <description>

### Component 2: <Name>
...

## Database Changes
<If any migrations needed>

## API Changes
<If any API endpoints change>

## Testing Strategy
- Unit tests: <what to test>
- Integration tests: <what to test>
- E2E tests: <what to test>

## Rollback Plan
<How to revert if issues arise>

IMPORTANT: Write the file now. Be thorough but practical.
EOF

    run_claude "opus" "$prompt_file"
    rm -f "$prompt_file"

    if [ ! -f "$specs_file" ]; then
        log_error "Specs file was not created: $specs_file"
        return 1
    fi

    log_success "Specifications created: $specs_file"
}

# =============================================================================
# PHASE 3: Create Tasks (cyolo/Claude Opus)
# =============================================================================
phase_create_tasks() {
    local cycle_letter=$1
    local slug=$2
    log_step "Phase 3: Creating task breakdown with Claude Opus..."

    local requirements_file="$LOOP_DIR/requirements-${cycle_letter}.md"
    local specs_file="$LOOP_DIR/specs-${slug}.md"
    local tasks_file="$LOOP_DIR/tasks-${slug}.md"
    local prompt_file="$LOOP_DIR/.prompt-tasks-${slug}.txt"

    cat > "$prompt_file" << EOF
You are a project manager breaking down technical work into actionable tasks.

READ:
- ${requirements_file}
- ${specs_file}

YOUR TASK:
Create a detailed task list at: ${tasks_file}

FORMAT:
# Tasks for: <Title>

## Status Legend
- [ ] Pending
- [x] Completed
- [~] In Progress

## Tasks

### 1. <Task Title>
- [ ] Description: <what needs to be done>
- Files: <files to modify>
- Acceptance: <how to verify it's done>

### 2. <Task Title>
...

## Notes
- <any important notes for implementation>

RULES:
1. Each task should be completable in one focused session
2. Tasks should be ordered by dependency (do X before Y)
3. Include testing tasks
4. Include documentation updates if needed
5. Maximum 10 tasks per improvement cycle

IMPORTANT: Write the file now.
EOF

    run_claude "opus" "$prompt_file"
    rm -f "$prompt_file"

    if [ ! -f "$tasks_file" ]; then
        log_error "Tasks file was not created: $tasks_file"
        return 1
    fi

    log_success "Tasks created: $tasks_file"
}

# Check if there are pending tasks using LLM
check_pending_tasks() {
    local tasks_file=$1
    local check_file="$LOOP_DIR/.check-pending.txt"
    local result_file="$LOOP_DIR/.check-result.txt"

    cat > "$check_file" << EOF
Read this file: ${tasks_file}

Check if there are any PENDING/INCOMPLETE tasks remaining.
Look for tasks marked with:
- [ ] (unchecked checkbox)
- "pending" status
- Tasks not marked as done/completed/[x]

IMPORTANT: Output ONLY one word:
- "pending" if there are incomplete tasks
- "done" if all tasks are completed

Output nothing else, just that one word.
EOF

    # Use claude with haiku for quick check (cheaper)
    if [ "$DRY_RUN" = true ]; then
        echo "pending"
        return
    fi

    claude --dangerously-skip-permissions --model haiku -p "$(cat "$check_file")" > "$result_file" 2>/dev/null

    local result
    result=$(cat "$result_file" | tr '[:upper:]' '[:lower:]' | grep -o -E '(pending|done)' | head -1)
    rm -f "$check_file" "$result_file"

    if [ "$result" = "done" ]; then
        echo "done"
    else
        echo "pending"
    fi
}

# =============================================================================
# PHASE 4: Execute Tasks (zyolo/Claude Code)
# =============================================================================
phase_execute_tasks() {
    local slug=$1
    log_step "Phase 4: Executing tasks with Claude Code..."

    local tasks_file="$LOOP_DIR/tasks-${slug}.md"
    local log_file="$LOOP_DIR/log-${slug}.md"
    local prompt_file="$LOOP_DIR/.prompt-execute-${slug}.txt"

    # Initialize log file
    cat > "$log_file" << EOF
# Implementation Log: ${slug}

Started: $(date)

EOF

    local iteration=0
    local max_task_iterations=50

    while [ $iteration -lt $max_task_iterations ]; do
        ((iteration++))
        log_info "Task iteration $iteration..."

        # Use LLM to check if there are pending tasks
        local task_status
        task_status=$(check_pending_tasks "$tasks_file")

        if [ "$task_status" = "done" ]; then
            log_success "All tasks completed!"
            break
        fi

        log_info "Tasks pending, continuing..."

        cat > "$prompt_file" << EOF
You are implementing improvements to a WhatsApp Web business messaging platform.

READ these files:
- ${tasks_file} (current task list)
- ${log_file} (implementation log)

YOUR TASK:
1. Find the FIRST pending/incomplete task
2. Implement it completely:
   - Write/modify the necessary code
   - Add appropriate tests
   - Ensure code compiles/runs
3. Update ${tasks_file}:
   - Mark the completed task as done (change [ ] to [x])
4. Append to ${log_file}:
   - What you did
   - Files modified
   - Any issues encountered

RULES:
- Complete ONLY ONE task per execution
- Be thorough - the task should be fully done
- If you encounter a blocker, document it and move on
- Follow existing code patterns and style

IMPORTANT: If ALL tasks are already completed, just say "All tasks done" and exit.
Otherwise, start working on the first pending task now.
EOF

        run_zyolo "$prompt_file"
        rm -f "$prompt_file"

        sleep 5
    done

    echo "" >> "$log_file"
    echo "Completed: $(date)" >> "$log_file"

    log_success "Task execution phase completed"
}

# =============================================================================
# PHASE 5: Review Changes (gyolo/Gemini)
# =============================================================================
phase_review_changes() {
    local slug=$1
    log_step "Phase 5: Reviewing changes with Gemini..."

    local specs_file="$LOOP_DIR/specs-${slug}.md"
    local tasks_file="$LOOP_DIR/tasks-${slug}.md"
    local log_file="$LOOP_DIR/log-${slug}.md"
    local review_file="$LOOP_DIR/review-${slug}.md"
    local prompt_file="$LOOP_DIR/.prompt-review-${slug}.txt"

    # Read file contents to include in prompt (avoids ignore pattern issues)
    local specs_content=""
    local tasks_content=""
    local log_content=""
    if [ -f "$specs_file" ]; then
        specs_content=$(cat "$specs_file" | head -150)
    fi
    if [ -f "$tasks_file" ]; then
        tasks_content=$(cat "$tasks_file")
    fi
    if [ -f "$log_file" ]; then
        log_content=$(cat "$log_file" | tail -100)
    fi

    cat > "$prompt_file" << EOF
You are a senior code reviewer evaluating implemented changes.

SPECIFICATIONS:
${specs_content}

TASKS:
${tasks_content}

IMPLEMENTATION LOG:
${log_content}

YOUR TASK:
1. Run 'git diff HEAD~10' to review all code changes
2. Check for:
   - Code quality issues
   - Missing error handling
   - Security concerns
   - Performance issues
   - Missing tests
   - Incomplete implementations

3. Write a review document to: ${review_file}

FORMAT for ${review_file}:
# Code Review: ${slug}

## Summary
<Overall assessment: APPROVED / NEEDS_CHANGES>

## What Was Done Well
- <positive feedback>

## Issues Found

### Critical (Must Fix)
- [ ] <issue description>
  - File: <path>
  - Fix: <suggested fix>

### Minor (Nice to Fix)
- [ ] <issue description>

## Additional Improvements
- [ ] <suggested future improvements>

## Verdict
<APPROVED or NEEDS_CHANGES>

If NEEDS_CHANGES, create additional tasks. If APPROVED, we proceed to PR.
EOF

    run_gemini "$prompt_file"
    rm -f "$prompt_file"

    if [ ! -f "$review_file" ]; then
        log_warn "Review file was not created, assuming APPROVED"
        cat > "$review_file" << EOF
# Code Review: ${slug}

## Verdict
APPROVED
EOF
    fi

    if grep -q "NEEDS_CHANGES" "$review_file"; then
        return 1
    fi

    return 0
}

# =============================================================================
# PHASE 6: Handle Review Feedback (zyolo)
# =============================================================================
phase_handle_review_feedback() {
    local slug=$1
    log_step "Phase 6: Addressing review feedback..."

    local review_file="$LOOP_DIR/review-${slug}.md"
    local log_file="$LOOP_DIR/log-${slug}.md"
    local prompt_file="$LOOP_DIR/.prompt-feedback-${slug}.txt"

    cat > "$prompt_file" << EOF
You are addressing code review feedback.

READ: ${review_file}

YOUR TASK:
1. Find all unchecked items in the 'Critical (Must Fix)' section
2. Fix each issue
3. Update ${review_file} - mark fixed items as [x]
4. Append what you fixed to ${log_file}

Work through ALL critical issues before stopping.
EOF

    run_zyolo "$prompt_file"
    rm -f "$prompt_file"

    log_success "Review feedback addressed"
}

# =============================================================================
# PHASE 7: Create Branch and PR (cyolo/Claude Sonnet)
# =============================================================================
phase_create_pr() {
    local slug=$1
    local base_branch=$2
    log_step "Phase 7: Creating branch and PR..."

    local branch_name="improvement/${slug}"
    local specs_file="$LOOP_DIR/specs-${slug}.md"
    local log_file="$LOOP_DIR/log-${slug}.md"
    local prompt_file="$LOOP_DIR/.prompt-pr-${slug}.txt"

    # Check if branch already exists
    if git show-ref --verify --quiet "refs/heads/$branch_name"; then
        log_info "Branch $branch_name already exists, checking out..."
        run_cmd git checkout "$branch_name"
    else
        log_info "Creating branch: $branch_name from $base_branch"
        run_cmd git checkout -b "$branch_name"
    fi

    run_cmd git add -A

    # Check if there are changes to commit
    if git diff --cached --quiet; then
        log_info "No staged changes to commit"
    else
        # Read file contents to include in prompt (avoids ignore pattern issues)
        local specs_content=""
        local log_content=""
        if [ -f "$specs_file" ]; then
            specs_content=$(cat "$specs_file" | head -100)
        fi
        if [ -f "$log_file" ]; then
            log_content=$(cat "$log_file" | head -100)
        fi

        cat > "$prompt_file" << EOF
You are creating a git commit and PR for the improvement work.

SPECS SUMMARY:
${specs_content}

LOG SUMMARY:
${log_content}

YOUR TASK:
1. Review the staged changes with: git diff --cached
2. Create a well-formatted commit:
   git commit -m "<type>(<scope>): <short description>"

   Types: feat, fix, refactor, perf, test, docs
   Scope: whatsapp, api, web, orchestrator, etc.

3. Push the branch:
   git push -u origin ${branch_name}

4. Check if PR exists, if not create one:
   gh pr list --head "${branch_name}" --json number | grep -q number || gh pr create --base "${base_branch}" --title "<title>" --body "<body>"

IMPORTANT: Run these git commands now.
EOF

        run_claude "sonnet" "$prompt_file"
        rm -f "$prompt_file"
    fi

    log_success "PR created for $branch_name"
    echo "$branch_name"
}

# =============================================================================
# Run a single improvement cycle (handles resume from any phase)
# =============================================================================
run_cycle() {
    local cycle_letter=$1
    local start_phase=${2:-0}
    local resume_slug=${3:-""}

    echo ""
    log_info "=============================================="
    log_info "IMPROVEMENT CYCLE: $cycle_letter (starting from phase $start_phase)"
    log_info "=============================================="
    echo ""

    local slug="$resume_slug"
    local current_focus=""

    # Phase 0: Determine focus
    if [ $start_phase -le 0 ]; then
        if [ -n "$FOCUS_AREA" ]; then
            current_focus="$FOCUS_AREA"
            log_info "Using specified focus: $current_focus"
        else
            log_agent "CYOLO" "Determining focus area..."
            current_focus=$(phase_determine_focus "$cycle_letter")
        fi
        save_state "$CURRENT_CYCLE" "$cycle_letter" "" 0 "focus" "$PREVIOUS_BRANCH"
    fi

    # Phase 1: Identify improvements
    if [ $start_phase -le 1 ]; then
        if [ -z "$current_focus" ]; then
            # Load focus from file if resuming
            local focus_file="$LOOP_DIR/focus-${cycle_letter}.md"
            if [ -f "$focus_file" ]; then
                current_focus=$(grep -E "^focus:" "$focus_file" | head -1 | cut -d: -f2 | tr -d ' ')
            fi
            current_focus=${current_focus:-"general"}
        fi

        log_agent "GYOLO" "Identifying improvements in: $current_focus"
        slug=$(phase_identify_improvements "$cycle_letter" "$current_focus")
        if [ -z "$slug" ]; then
            log_error "Failed to identify improvements. Stopping."
            return 1
        fi
        log_success "Improvement identified: $slug"
        save_state "$CURRENT_CYCLE" "$cycle_letter" "$slug" 1 "requirements" "$PREVIOUS_BRANCH"
    fi

    # Use resume_slug if we're resuming from a later phase
    if [ -n "$resume_slug" ] && [ -z "$slug" ]; then
        slug="$resume_slug"
    fi

    # Phase 2: Create specifications
    if [ $start_phase -le 2 ]; then
        log_agent "CYOLO" "Creating specifications..."
        phase_create_specs "$cycle_letter" "$slug"
        save_state "$CURRENT_CYCLE" "$cycle_letter" "$slug" 2 "specs" "$PREVIOUS_BRANCH"
    fi

    # Phase 3: Create tasks
    if [ $start_phase -le 3 ]; then
        log_agent "CYOLO" "Breaking down into tasks..."
        phase_create_tasks "$cycle_letter" "$slug"
        save_state "$CURRENT_CYCLE" "$cycle_letter" "$slug" 3 "tasks" "$PREVIOUS_BRANCH"
    fi

    # Phase 4: Execute tasks
    if [ $start_phase -le 4 ]; then
        log_agent "ZYOLO" "Implementing tasks..."
        phase_execute_tasks "$slug"
        save_state "$CURRENT_CYCLE" "$cycle_letter" "$slug" 4 "execute" "$PREVIOUS_BRANCH"
    fi

    # Phase 5 & 6: Review loop
    if [ $start_phase -le 5 ]; then
        local review_iterations=0
        local max_review_iterations=3

        while [ $review_iterations -lt $max_review_iterations ]; do
            ((review_iterations++))
            log_agent "GYOLO" "Reviewing changes (iteration $review_iterations)..."
            save_state "$CURRENT_CYCLE" "$cycle_letter" "$slug" 5 "review" "$PREVIOUS_BRANCH"

            if phase_review_changes "$slug"; then
                log_success "Changes approved!"
                break
            else
                log_warn "Review requested changes..."
                log_agent "ZYOLO" "Addressing feedback..."
                save_state "$CURRENT_CYCLE" "$cycle_letter" "$slug" 6 "feedback" "$PREVIOUS_BRANCH"
                phase_handle_review_feedback "$slug"
            fi
        done
    fi

    # Phase 7: Create branch and PR
    if [ $start_phase -le 7 ]; then
        log_agent "CYOLO" "Creating branch and PR..."
        save_state "$CURRENT_CYCLE" "$cycle_letter" "$slug" 7 "pr" "$PREVIOUS_BRANCH"
        local new_branch
        new_branch=$(phase_create_pr "$slug" "$PREVIOUS_BRANCH")
        PREVIOUS_BRANCH="$new_branch"

        log_success "=============================================="
        log_success "CYCLE $cycle_letter COMPLETED: $slug"
        log_success "Branch: $new_branch"
        log_success "=============================================="

        # Clear state after successful completion
        rm -f "$STATE_FILE"
    fi

    return 0
}

# =============================================================================
# Main Loop
# =============================================================================
main() {
    log_info "Starting Improvement Loop"
    if [ -n "$FOCUS_AREA" ]; then
        log_info "Focus: $FOCUS_AREA (manual)"
    else
        log_info "Focus: AUTO-DETECT (cyolo will analyze each cycle)"
    fi
    log_info "Max cycles: $( [ $MAX_CYCLES -eq -1 ] && echo 'unlimited' || echo $MAX_CYCLES )"
    log_info "Cooldown: ${COOLDOWN_SECONDS}s between cycles"
    if [ "$RESUME_MODE" = true ]; then
        log_info "Mode: RESUME from saved state"
    fi
    echo ""

    init_loop_dir

    # Handle resume mode
    if [ "$RESUME_MODE" = true ]; then
        load_state
        log_info "Resuming cycle from phase $RESUME_PHASE..."

        local cycle_letter
        cycle_letter=$(get_cycle_letter $CURRENT_CYCLE)

        run_cycle "$cycle_letter" "$RESUME_PHASE" "$RESUME_SLUG"

        # After resume, continue to next cycle
        ((CURRENT_CYCLE++))
    else
        log_info "Checking out main branch..."
        run_cmd git checkout main
        run_cmd git pull origin main
        PREVIOUS_BRANCH="main"
    fi

    while true; do
        if [ $MAX_CYCLES -ne -1 ] && [ $CURRENT_CYCLE -ge $MAX_CYCLES ]; then
            log_info "Reached max cycles ($MAX_CYCLES). Stopping."
            break
        fi

        local cycle_letter
        cycle_letter=$(get_cycle_letter $CURRENT_CYCLE)
        ((CURRENT_CYCLE++))

        run_cycle "$cycle_letter" 0 ""

        if [ $MAX_CYCLES -eq -1 ] || [ $CURRENT_CYCLE -lt $MAX_CYCLES ]; then
            log_info "Cooling down for ${COOLDOWN_SECONDS}s before next cycle..."
            sleep $COOLDOWN_SECONDS
        fi
    done

    echo ""
    log_success "Improvement Loop finished!"
    log_info "Total cycles completed: $CURRENT_CYCLE"
    log_info "Check .loop/ directory for artifacts"
    log_info "Review PRs in order: improvement/a, improvement/b, ..."
}

main "$@"
