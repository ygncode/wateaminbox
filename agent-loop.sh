#!/bin/bash

# =============================================================================
# Agent Loop - Autonomous AI-driven code workflow
# =============================================================================
#
# Usage: ./agent-loop.sh <tasks.md> [OPTIONS]
#
# The tasks.md file contains a list of high-level tasks:
#   - [ ] fix the login bug
#   - [ ] add rate limiting to API
#   - [ ] improve error handling
#
# For each task, the script will:
#   1. Classify task type (feature/bug/chore/refactor/docs) using Haiku
#   2. Route to appropriate workflow:
#      - FEATURE:  Full (requirements → specs → subtasks → execute → review → merge)
#      - REFACTOR: Medium (requirements → subtasks → execute → review → merge)
#      - BUG:      Light (direct fix → code review → merge)
#      - CHORE:    Light (direct fix → code review → merge)
#      - DOCS:     Minimal (direct fix → merge)
#   3. Auto squash-merge and sync main
#   4. Mark task as [x] done in tasks.md
#   5. Move to next task
#
# Options:
#   --max-review-iters N    Max review iterations per phase (default: 3)
#   --dry-run               Print commands without executing
#   --resume                Resume from saved state
#   --verbose               Show detailed output
#   --skip-merge            Create PR but don't auto-merge
#
# =============================================================================

# NOTE: We do NOT use set -e because we handle errors explicitly
# set -e would cause script to die on any command failure

# Load .env if exists
if [ -f "$(pwd)/.env" ]; then
    set -a
    source "$(pwd)/.env"
    set +a
fi

# =============================================================================
# Configuration
# =============================================================================
PROJECT_DIR="$(pwd)"
LOOP_DIR="$PROJECT_DIR/.loop"
TASKS_FILE=""
DRY_RUN=false
RESUME_MODE=false
VERBOSE=false
SKIP_MERGE=false

# State tracking
CURRENT_TASK=""
CURRENT_TASK_INDEX=0
CURRENT_SLUG=""
CURRENT_TASK_TYPE=""  # feature, bug, chore, refactor, docs

# Worktree management
WORKTREES_DIR="$PROJECT_DIR/.worktrees"
USE_WORKTREE=false
WORKTREE_PATH=""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m'

# =============================================================================
# Argument Parsing
# =============================================================================
parse_args() {
    while [[ "$#" -gt 0 ]]; do
        case $1 in
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            --resume)
                RESUME_MODE=true
                shift
                ;;
            --verbose)
                VERBOSE=true
                shift
                ;;
            --skip-merge)
                SKIP_MERGE=true
                shift
                ;;
            -h|--help)
                show_help
                exit 0
                ;;
            -*)
                log_error "Unknown option: $1"
                show_help
                exit 1
                ;;
            *)
                if [ -z "$TASKS_FILE" ]; then
                    TASKS_FILE="$1"
                fi
                shift
                ;;
        esac
    done

    if [ -z "$TASKS_FILE" ] && [ "$RESUME_MODE" != true ]; then
        log_error "Tasks file required. Usage: $0 <tasks.md> [OPTIONS]"
        exit 1
    fi
}

show_help() {
    cat << 'EOF'
Agent Loop - Fully Autonomous AI-driven code workflow

Usage: ./agent-loop.sh <tasks.md> [OPTIONS]

The tasks.md file contains a list of high-level tasks:
  - [ ] fix the login bug
  - [ ] add rate limiting to API
  - [ ] improve error handling

For each task, the AI will:
  1. Classify task type (feature/bug/chore/refactor/docs)
  2. Route to appropriate workflow:

     FEATURE  → Full    (requirements → specs → subtasks → execute → review → test → merge)
     REFACTOR → Medium  (requirements → subtasks → execute → review → test → merge)
     BUG      → Light   (direct fix → code review → test → merge)
     CHORE    → Light   (direct fix → code review → test → merge)
     DOCS     → Minimal (direct fix → test → merge)

  3. Auto squash-merge and sync main
  4. Mark task as [x] done in tasks.md
  5. Move to next task

AI handles ALL decisions:
  - Picks model: Haiku classifies → Sonnet (simple) or Opus (complex)
  - Reviews until approved (no iteration limit)
  - Tests until pass or blocked
  - Resolves git conflicts
  - Waits for CI, retries merges
  - Fixes errors and retries

Options:
  --dry-run               Print commands without executing
  --resume                Resume from saved state in .loop/state.json
  --verbose               Show detailed output
  --skip-merge            Create PR but don't auto-merge
  -h, --help              Show this help message

State:
  - All artifacts stored in .loop/{slug}/
  - Resume capability via --resume flag
  - System prompt loaded from .loop/.system-prompt.md if exists
EOF
}

# =============================================================================
# Logging
# =============================================================================
log_info() { echo -e "${BLUE}[INFO]${NC} $1" >&2; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1" >&2; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1" >&2; }
log_error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }
log_step() { echo -e "${PURPLE}[STEP]${NC} $1" >&2; }
log_agent() { echo -e "${CYAN}[AGENT]${NC} $1" >&2; }
log_review() { echo -e "${YELLOW}[REVIEW]${NC} $1" >&2; }
log_verbose() {
    if [ "$VERBOSE" = true ]; then
        echo -e "${BLUE}[DEBUG]${NC} $1" >&2
    fi
}

# =============================================================================
# Core Functions
# =============================================================================

# Classify task complexity using Haiku (fast/cheap)
# Returns: "simple" or "complex"
classify_complexity() {
    local task_description="$1"

    if [ "$DRY_RUN" = true ]; then
        echo "complex"
        return
    fi

    local classify_prompt="Classify this task's complexity for an AI coding assistant:

TASK: $task_description

SIMPLE tasks (use Sonnet):
- Single file changes
- Bug fixes with clear cause
- Adding simple functions
- Config changes
- Documentation updates
- Straightforward refactors
- Code that follows existing patterns

COMPLEX tasks (use Opus):
- Multi-file architectural changes
- Designing new systems/features
- Complex debugging requiring deep analysis
- Security-sensitive code
- Performance optimization
- Database migrations
- API design decisions
- Anything requiring creative problem-solving

Output ONLY one word: 'simple' or 'complex'. Nothing else."

    local result
    result=$(claude --dangerously-skip-permissions --model haiku -p "$classify_prompt" 2>/dev/null | tr '[:upper:]' '[:lower:]' | grep -o -E '(simple|complex)' | head -1)

    echo "${result:-complex}"
}

# Classify if task needs worktree (isolated environment) using Haiku
# Returns: "worktree" or "inplace"
classify_worktree_need() {
    local task_description="$1"
    local task_type="$2"

    if [ "$DRY_RUN" = true ]; then
        echo "inplace"
        return
    fi

    local classify_prompt="Decide if this coding task should use a git worktree (isolated directory) or work in-place.

TASK: $task_description
TASK TYPE: $task_type

Use WORKTREE when:
- Heavy/disruptive changes that would interrupt someone testing the main code
- Multi-file refactoring that touches many parts of the codebase
- New feature implementation with many new files
- Database migrations or schema changes
- Changes that require significant build/compile time
- Risky changes that might break the build temporarily

Use INPLACE when:
- Small bug fixes (1-3 files)
- Documentation updates
- Config changes
- Simple chores (dependency updates)
- Quick fixes that won't disrupt testing
- Changes that are low-risk and fast to implement

Output ONLY one word: 'worktree' or 'inplace'. Nothing else."

    local result
    result=$(claude --dangerously-skip-permissions --model haiku -p "$classify_prompt" 2>/dev/null | tr '[:upper:]' '[:lower:]' | grep -o -E '(worktree|inplace)' | head -1)

    echo "${result:-inplace}"
}

# Run cyolo with smart model selection
# AI (Haiku) decides whether to use Sonnet (simple) or Opus (complex)
run_cyolo() {
    local prompt="$1"
    local description="${2:-Running agent}"
    local force_model="${3:-auto}"  # auto, sonnet, or opus

    log_agent "$description"

    if [ "$DRY_RUN" = true ]; then
        echo "[DRY-RUN] claude --dangerously-skip-permissions --model <auto> -p <prompt>" >&2
        return 0
    fi

    # Determine model to use
    local model="opus"
    if [ "$force_model" = "auto" ]; then
        local complexity
        complexity=$(classify_complexity "$description")
        if [ "$complexity" = "simple" ]; then
            model="sonnet"
            log_verbose "Complexity: SIMPLE → using Sonnet"
        else
            model="opus"
            log_verbose "Complexity: COMPLEX → using Opus"
        fi
    elif [ "$force_model" = "sonnet" ]; then
        model="sonnet"
    else
        model="opus"
    fi

    # Load system prompt if exists
    local system_prompt=""
    if [ -f "$LOOP_DIR/.system-prompt.md" ]; then
        system_prompt=$(cat "$LOOP_DIR/.system-prompt.md")
        prompt="$system_prompt

---

$prompt"
        log_verbose "Loaded system prompt from .loop/.system-prompt.md"
    fi

    claude --dangerously-skip-permissions --model "$model" -p "$prompt" >&2
}

# Run command (for git, etc.)
run_cmd() {
    if [ "$DRY_RUN" = true ]; then
        echo "[DRY-RUN] $*" >&2
        return 0
    fi
    "$@"
}

# Generate slug from task description
generate_slug() {
    local task_description="$1"
    local slug_file="$LOOP_DIR/.slug-temp.txt"

    local prompt="Analyze this task and generate a short, descriptive slug (kebab-case, 2-4 words).
Examples: 'api-rate-limiting', 'contact-sync-fix', 'websocket-reconnect', 'message-delivery-timeout'

Task: $task_description

Output ONLY the slug, nothing else. No explanation, no quotes, just the slug."

    if [ "$DRY_RUN" = true ]; then
        echo "dry-run-slug-$(date +%s)"
        return
    fi

    mkdir -p "$LOOP_DIR"
    claude --dangerously-skip-permissions --model haiku -p "$prompt" > "$slug_file" 2>/dev/null

    local slug
    slug=$(cat "$slug_file" | tr -d '\n' | tr -d ' ' | tr '[:upper:]' '[:lower:]')
    rm -f "$slug_file"

    # Validate slug format
    if [[ ! "$slug" =~ ^[a-z0-9-]+$ ]]; then
        slug="task-$(date +%Y%m%d-%H%M%S)"
        log_warn "Generated fallback slug: $slug"
    fi

    echo "$slug"
}

# Classify task type using Haiku (fast/cheap)
classify_task() {
    local task_description="$1"

    log_step "Classifying task type..."

    if [ "$DRY_RUN" = true ]; then
        echo "feature"
        return
    fi

    local classify_prompt="Classify this task into ONE of these categories:
- feature: New functionality, adding capabilities
- bug: Fixing broken behavior, errors, crashes
- chore: Maintenance, dependencies, cleanup, config
- refactor: Code restructuring without changing behavior
- docs: Documentation updates, comments, README

Task: $task_description

Rules:
- If it mentions 'fix', 'broken', 'error', 'not working' → bug
- If it mentions 'add', 'implement', 'new', 'create' → feature
- If it mentions 'update deps', 'cleanup', 'remove unused' → chore
- If it mentions 'refactor', 'restructure', 'improve code' → refactor
- If it mentions 'docs', 'readme', 'comments', 'documentation' → docs

Output ONLY one word: feature, bug, chore, refactor, or docs. Nothing else."

    local result
    result=$(claude --dangerously-skip-permissions --model haiku -p "$classify_prompt" 2>/dev/null | tr -d '\n' | tr '[:upper:]' '[:lower:]' | grep -o -E '(feature|bug|chore|refactor|docs)' | head -1)

    # Default to feature if classification fails
    if [ -z "$result" ]; then
        result="feature"
        log_warn "Classification failed, defaulting to: $result"
    fi

    log_success "Task classified as: $result"
    echo "$result"
}

# =============================================================================
# Task List Management
# =============================================================================

# Detect input format: "checklist" or "feature" using Haiku
detect_input_format() {
    local file="$1"

    if [ ! -f "$file" ]; then
        echo "feature"
        return
    fi

    if [ "$DRY_RUN" = true ]; then
        # Fallback to simple grep check in dry-run mode
        if grep -q '^\s*-\s*\[ \]' "$file" 2>/dev/null; then
            echo "checklist"
        else
            echo "feature"
        fi
        return
    fi

    local content
    content=$(cat "$file")

    local detect_prompt="Analyze this input file and determine its format.

FILE CONTENT:
$content

OUTPUT ONLY ONE WORD:
- 'checklist' if this is a task list with multiple independent items to do one by one (like todo items, checkboxes, numbered tasks, bullet points with separate tasks)
- 'feature' if this is a single feature description, requirement document, specification, or one cohesive thing to implement as a unit

Reply with ONLY 'checklist' or 'feature', nothing else."

    local result
    result=$(claude --dangerously-skip-permissions --model haiku -p "$detect_prompt" 2>/dev/null | tr '[:upper:]' '[:lower:]' | grep -o -E '(checklist|feature)' | head -1)

    echo "${result:-feature}"
}

# Get next unchecked task from tasks.md (checklist format)
get_next_task() {
    local tasks_file="$1"

    if [ ! -f "$tasks_file" ]; then
        echo ""
        return
    fi

    # Find first line matching "- [ ]" pattern
    local task_line
    task_line=$(grep -n '^\s*-\s*\[ \]' "$tasks_file" | head -1)

    if [ -z "$task_line" ]; then
        echo ""
        return
    fi

    # Extract line number and task description
    local line_num
    line_num=$(echo "$task_line" | cut -d: -f1)
    local task_desc
    task_desc=$(echo "$task_line" | cut -d: -f2- | sed 's/^\s*-\s*\[ \]\s*//')

    echo "$line_num|$task_desc"
}

# Get feature description from file (feature format)
get_feature_task() {
    local file="$1"

    if [ ! -f "$file" ]; then
        echo ""
        return
    fi

    # Read entire file as the task description
    cat "$file"
}

# Mark task as completed in tasks.md
mark_task_complete() {
    local tasks_file="$1"
    local line_num="$2"

    if [ "$DRY_RUN" = true ]; then
        echo "[DRY-RUN] Mark line $line_num as [x] in $tasks_file" >&2
        return 0
    fi

    # Replace "- [ ]" with "- [x]" on the specific line
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "${line_num}s/- \[ \]/- [x]/" "$tasks_file"
    else
        sed -i "${line_num}s/- \[ \]/- [x]/" "$tasks_file"
    fi

    log_success "Marked task on line $line_num as complete in $tasks_file"
}

# Count remaining tasks
count_remaining_tasks() {
    local tasks_file="$1"
    grep -c '^\s*-\s*\[ \]' "$tasks_file" 2>/dev/null || echo "0"
}

# =============================================================================
# Context Management
# =============================================================================

# Initialize context.md for a task
init_context() {
    local work_dir="$LOOP_DIR/$CURRENT_SLUG"
    local context_file="$work_dir/context.md"

    mkdir -p "$work_dir"

    if [ -f "$context_file" ]; then
        log_verbose "Context file already exists: $context_file"
        return 0
    fi

    cat > "$context_file" << EOF
# Context: $CURRENT_SLUG

Task: $CURRENT_TASK
Type: $CURRENT_TASK_TYPE
Started: $(date -Iseconds)

---

## Discoveries
<!-- Codebase findings: files, patterns, architecture insights -->

## Decisions
<!-- Key decisions and rationale (e.g., "chose X over Y because...") -->

## Progress
<!-- Running summary of what's been done -->

EOF

    log_verbose "Initialized context file: $context_file"
}

# Get context file path for current task
get_context_file() {
    echo "$LOOP_DIR/$CURRENT_SLUG/context.md"
}

# Build context instruction for prompts
# Usage: $(build_context_instruction "read") or $(build_context_instruction "read_write")
build_context_instruction() {
    local mode="${1:-read_write}"
    local context_file
    context_file=$(get_context_file)

    if [ "$mode" = "read" ]; then
        echo "CONTEXT FILE: $context_file
- Read this file FIRST to understand prior discoveries and decisions
- This contains insights from previous phases - leverage them, don't re-discover"
    else
        echo "CONTEXT FILE: $context_file
- Read this file FIRST to understand prior discoveries and decisions
- UPDATE it continuously as you work:
  - Add codebase discoveries to ## Discoveries (files found, patterns, insights)
  - Add key decisions to ## Decisions (what you chose and why)
  - Update ## Progress with what you accomplished
- Keep entries concise but informative for future phases"
    fi
}

# =============================================================================
# State Management
# =============================================================================
STATE_FILE="$LOOP_DIR/state.json"

save_state() {
    local phase="$1"
    local phase_name="$2"
    local review_iter="${3:-0}"

    mkdir -p "$LOOP_DIR"

    cat > "$STATE_FILE" << EOF
{
  "tasks_file": "$TASKS_FILE",
  "current_task": "$CURRENT_TASK",
  "current_task_index": $CURRENT_TASK_INDEX,
  "slug": "$CURRENT_SLUG",
  "task_type": "$CURRENT_TASK_TYPE",
  "phase": "$phase",
  "phase_name": "$phase_name",
  "review_iteration": $review_iter,
  "last_updated": "$(date -Iseconds)"
}
EOF
    log_verbose "State saved: phase=$phase ($phase_name), task=$CURRENT_TASK_INDEX, slug=$CURRENT_SLUG"
}

load_state() {
    if [ ! -f "$STATE_FILE" ]; then
        log_error "No state file found at $STATE_FILE"
        exit 1
    fi

    TASKS_FILE=$(grep '"tasks_file"' "$STATE_FILE" | cut -d'"' -f4)
    # For current_task, we need to handle multiline JSON - extract everything between first and last quote
    CURRENT_TASK=$(sed -n 's/.*"current_task": "\(.*\)",$/\1/p' "$STATE_FILE" | head -1)
    # If task is multiline, just get a summary (first line)
    if [ -z "$CURRENT_TASK" ]; then
        CURRENT_TASK=$(grep -A1 '"current_task"' "$STATE_FILE" | tail -1 | sed 's/^[[:space:]]*//' | cut -c1-100)
    fi
    CURRENT_TASK_INDEX=$(grep '"current_task_index"' "$STATE_FILE" | grep -o '[0-9]*' | head -1)
    CURRENT_SLUG=$(grep '"slug"' "$STATE_FILE" | cut -d'"' -f4)
    CURRENT_TASK_TYPE=$(grep '"task_type"' "$STATE_FILE" | cut -d'"' -f4)

    # Set global LOADED_PHASE instead of echoing (to avoid subshell issues)
    LOADED_PHASE=$(grep '"phase"' "$STATE_FILE" | cut -d'"' -f4)
    local phase_name
    phase_name=$(grep '"phase_name"' "$STATE_FILE" | cut -d'"' -f4)

    log_success "State loaded: phase=$LOADED_PHASE ($phase_name), type=$CURRENT_TASK_TYPE, slug=$CURRENT_SLUG"
}

clear_state() {
    rm -f "$STATE_FILE"
    log_verbose "State cleared"
}

# =============================================================================
# Git Operations
# =============================================================================

# Sync with main branch - AI handles any issues
sync_main() {
    log_step "Syncing with main branch..."

    local sync_prompt="You need to sync with the main branch.

DO THE FOLLOWING:
1. Check git status - if there are uncommitted changes, stash them
2. Checkout main branch
3. Pull latest from origin/main
4. If there are any conflicts or issues, resolve them

HANDLE ERRORS:
- If checkout fails due to changes, stash first then checkout
- If pull has conflicts, resolve them or reset to origin/main
- If anything fails, fix it and try again

Run these git commands now and ensure we're on a clean, up-to-date main branch."

    run_cyolo "$sync_prompt" "Syncing with main..."
    log_success "Synced with main"
}

# Create branch for current task (with optional worktree)
create_branch() {
    local branch_name="improvement/$CURRENT_SLUG"

    # Classify if worktree is needed
    local worktree_decision
    worktree_decision=$(classify_worktree_need "$CURRENT_TASK" "$CURRENT_TASK_TYPE")

    if [ "$worktree_decision" = "worktree" ]; then
        USE_WORKTREE=true
        log_info "Using git worktree for isolation"
        setup_worktree "$branch_name"
    else
        USE_WORKTREE=false
        WORKTREE_PATH=""
        log_info "Working in-place (low disruption task)"

        # Standard branch creation
        log_info "Creating branch: $branch_name"
        run_cmd git checkout main

        if git show-ref --verify --quiet "refs/heads/$branch_name"; then
            log_warn "Branch $branch_name already exists, checking out..."
            run_cmd git checkout "$branch_name"
        else
            run_cmd git checkout -b "$branch_name"
        fi
    fi

    echo "$branch_name"
}

# Setup git worktree for isolated development
setup_worktree() {
    local branch_name="$1"

    WORKTREE_PATH="$WORKTREES_DIR/$CURRENT_SLUG"

    log_info "Creating worktree at: $WORKTREE_PATH"

    # Create worktrees directory if needed
    mkdir -p "$WORKTREES_DIR"

    # Clean up existing worktree if it exists
    if [ -d "$WORKTREE_PATH" ]; then
        log_warn "Worktree already exists, removing..."
        run_cmd git worktree remove "$WORKTREE_PATH" --force 2>/dev/null || true
        rm -rf "$WORKTREE_PATH" 2>/dev/null || true
    fi

    # Make sure we're on main and have latest
    run_cmd git checkout main
    run_cmd git pull origin main 2>/dev/null || true

    # Create new worktree with branch
    if git show-ref --verify --quiet "refs/heads/$branch_name"; then
        # Branch exists, create worktree pointing to it
        run_cmd git worktree add "$WORKTREE_PATH" "$branch_name"
    else
        # Create new branch in worktree
        run_cmd git worktree add -b "$branch_name" "$WORKTREE_PATH" main
    fi

    log_success "Worktree ready at: $WORKTREE_PATH"

    # Change to worktree directory
    cd "$WORKTREE_PATH" || {
        log_error "Failed to change to worktree directory"
        return 1
    }

    log_info "Working directory: $(pwd)"
}

# Cleanup git worktree after merge
cleanup_worktree() {
    if [ "$USE_WORKTREE" != true ] || [ -z "$WORKTREE_PATH" ]; then
        return 0
    fi

    log_info "Cleaning up worktree: $WORKTREE_PATH"

    # Return to project directory first
    cd "$PROJECT_DIR" || true

    # Remove the worktree
    run_cmd git worktree remove "$WORKTREE_PATH" --force 2>/dev/null || {
        log_warn "Could not remove worktree gracefully, forcing removal..."
        rm -rf "$WORKTREE_PATH" 2>/dev/null || true
        run_cmd git worktree prune 2>/dev/null || true
    }

    log_success "Worktree cleaned up"

    # Reset worktree state
    USE_WORKTREE=false
    WORKTREE_PATH=""
}

# =============================================================================
# Phase 1: Generate Requirements
# =============================================================================
phase_requirements() {
    log_step "Phase 1: Generating requirements..."

    local work_dir="$LOOP_DIR/$CURRENT_SLUG"
    mkdir -p "$work_dir"

    local req_file="$work_dir/requirement.md"
    local context_instruction
    context_instruction=$(build_context_instruction "read_write")

    local prompt="You are analyzing a task and creating a detailed requirements document.

PROJECT CONTEXT:
- This is a WhatsApp Web business messaging platform
- Multi-tenant architecture with PostgreSQL
- Go services (whatsapp, orchestrator) + TypeScript (Hono API, React frontend)
- See CLAUDE.md for full architecture details

$context_instruction

USER TASK:
$CURRENT_TASK

YOUR TASK:
1. Analyze the task thoroughly
2. Research the codebase to understand current state
3. Update context.md with discoveries (files found, patterns, architecture insights)
4. Create a comprehensive requirements document at: $req_file

FORMAT for $req_file:
# Requirements: <Title>

## Overview
<Brief summary of what needs to be done>

## Current State
<What exists currently, based on codebase analysis>

## Requirements

### Functional Requirements
- FR1: <requirement>
- FR2: <requirement>

### Non-Functional Requirements
- NFR1: <scalability, maintainability, etc.>

## Constraints
- <any technical constraints or limitations>

## Out of Scope
- <what is NOT included in this task>

## Success Criteria
- <how to verify the task is complete>

IMPORTANT: Write the file now. Be thorough and specific. Update context.md with your discoveries."

    run_cyolo "$prompt" "Generating requirements..."
    save_state "1" "requirements"

    if [ ! -f "$req_file" ]; then
        log_error "Requirements file was not created: $req_file"
        return 1
    fi

    log_success "Requirements generated: $req_file"
}

# =============================================================================
# Phase 2: Review Requirements (AI handles entire review loop)
# =============================================================================
phase_review_requirements() {
    log_step "Phase 2: Reviewing requirements..."

    local work_dir="$LOOP_DIR/$CURRENT_SLUG"
    local req_file="$work_dir/requirement.md"
    local review_file="$work_dir/requirement-review.md"

    save_state "2" "requirements-review"

    local review_prompt="You are reviewing requirements and iterating until they are APPROVED.

REQUIREMENTS FILE: $req_file
REVIEW FILE: $review_file

YOUR TASK - KEEP ITERATING UNTIL APPROVED:

1. Read the requirements from $req_file

2. Review against these criteria:
   - Scalability - Will this scale?
   - Maintainability - Easy to maintain?
   - Security - Any security implications?
   - Completeness - All edge cases covered?
   - Clarity - Clear and testable?
   - Feasibility - Technically achievable?

3. Write your review to $review_file with format:
   # Requirements Review
   ## Verdict: APPROVED | NEEDS_REVISION
   ## Issues Found
   ### Critical (Must Fix)
   - [ ] issue
   ## Summary

4. If NEEDS_REVISION:
   - Fix ALL critical issues in $req_file
   - Mark fixed items [x] in $review_file
   - Review again
   - REPEAT until APPROVED

5. If APPROVED:
   - Write final 'APPROVED' verdict
   - You're done!

RULES:
- Do NOT stop until requirements are APPROVED
- Be thorough but practical
- Fix issues yourself, don't just list them

Start reviewing now and keep iterating until APPROVED."

    run_cyolo "$review_prompt" "Reviewing requirements until approved..."
    log_success "Requirements review completed"
}

# =============================================================================
# Phase 3: Generate Specifications
# =============================================================================
phase_specs() {
    log_step "Phase 3: Generating specifications..."

    local work_dir="$LOOP_DIR/$CURRENT_SLUG"
    local req_file="$work_dir/requirement.md"
    local specs_file="$work_dir/specs.md"
    local context_instruction
    context_instruction=$(build_context_instruction "read_write")

    save_state "3" "specs"

    local req_content
    req_content=$(cat "$req_file")

    local specs_prompt="You are a senior software architect creating detailed technical specifications.

REQUIREMENTS:
$req_content

$context_instruction

YOUR TASK:
1. Read context.md FIRST - leverage discoveries from requirements phase
2. Analyze the requirements
3. Research codebase further if needed (update context.md with new discoveries)
4. Create detailed technical specifications at: $specs_file
5. Update context.md with architecture decisions made

FORMAT for $specs_file:
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
  - \`functionName(params)\`: <description>

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

## Error Handling
<How errors should be handled>

## Rollback Plan
<How to revert if issues arise>

IMPORTANT: Write the file now. Be thorough but practical. Update context.md with your decisions."

    run_cyolo "$specs_prompt" "Generating specifications..."

    if [ ! -f "$specs_file" ]; then
        log_error "Specs file was not created: $specs_file"
        return 1
    fi

    log_success "Specifications generated: $specs_file"
}

# =============================================================================
# Phase 4: Review Specifications (AI handles entire review loop)
# =============================================================================
phase_review_specs() {
    log_step "Phase 4: Reviewing specifications..."

    local work_dir="$LOOP_DIR/$CURRENT_SLUG"
    local specs_file="$work_dir/specs.md"
    local review_file="$work_dir/specs-review.md"

    save_state "4" "specs-review"

    local review_prompt="You are reviewing technical specifications and iterating until APPROVED.

SPECS FILE: $specs_file
REVIEW FILE: $review_file

YOUR TASK - KEEP ITERATING UNTIL APPROVED:

1. Read the specifications from $specs_file

2. Review against these criteria:
   - Technical Accuracy - Is the approach correct?
   - Completeness - All requirements addressed?
   - Code Quality - Will this produce maintainable code?
   - Performance - Any performance concerns?
   - Security - Any security issues?
   - Testing - Adequate testing strategy?

3. Write your review to $review_file with format:
   # Specifications Review
   ## Verdict: APPROVED | NEEDS_REVISION
   ## Issues Found
   ### Critical (Must Fix)
   - [ ] issue
   ## Summary

4. If NEEDS_REVISION:
   - Fix ALL critical issues in $specs_file
   - Mark fixed items [x] in $review_file
   - Review again
   - REPEAT until APPROVED

5. If APPROVED:
   - Write final 'APPROVED' verdict
   - You're done!

RULES:
- Do NOT stop until specs are APPROVED
- Be thorough but practical
- Fix issues yourself, don't just list them

Start reviewing now and keep iterating until APPROVED."

    run_cyolo "$review_prompt" "Reviewing specifications until approved..."
    log_success "Specifications review completed"
}

# =============================================================================
# Phase 5: Generate Sub-Tasks
# =============================================================================
phase_subtasks() {
    log_step "Phase 5: Generating sub-tasks..."

    local work_dir="$LOOP_DIR/$CURRENT_SLUG"
    local req_file="$work_dir/requirement.md"
    local specs_file="$work_dir/specs.md"
    local subtasks_file="$work_dir/subtasks.md"
    local context_instruction
    context_instruction=$(build_context_instruction "read")

    save_state "5" "subtasks"

    local tasks_prompt="You are a project manager breaking down technical work into actionable tasks.

REQUIREMENTS:
$(cat "$req_file")

SPECIFICATIONS:
$(cat "$specs_file")

$context_instruction

YOUR TASK:
1. Read context.md FIRST - it has file locations and architecture decisions
2. Create a detailed task list at: $subtasks_file
3. Use discoveries from context.md to be specific about file paths

FORMAT:
# Sub-Tasks: <Title>

## Status Legend
- [ ] Pending
- [x] Completed
- [~] In Progress
- [!] Blocked

## Tasks

### 1. <Task Title>
- [ ] Status: Pending
- Description: <what needs to be done>
- Files: <files to modify>
- Acceptance: <how to verify it's done>

### 2. <Task Title>
- [ ] Status: Pending
- Description: <what needs to be done>
- Files: <files to modify>
- Acceptance: <how to verify it's done>

...

## Notes
- <any important notes for implementation>

RULES:
1. Each task should be completable in one focused session
2. Tasks should be ordered by dependency
3. Include testing tasks for each component
4. Maximum 15 tasks
5. Be specific about files and changes - use paths from context.md

IMPORTANT: Write the file now."

    run_cyolo "$tasks_prompt" "Generating sub-tasks..."

    if [ ! -f "$subtasks_file" ]; then
        log_error "Sub-tasks file was not created: $subtasks_file"
        return 1
    fi

    log_success "Sub-tasks generated: $subtasks_file"
}

# =============================================================================
# Phase 6: Execute Sub-Tasks (AI decides batch, script loops)
# =============================================================================
phase_execute() {
    log_step "Phase 6: Executing sub-tasks..."

    local work_dir="$LOOP_DIR/$CURRENT_SLUG"
    local subtasks_file="$work_dir/subtasks.md"
    local log_file="$work_dir/execution-log.md"
    local max_iterations=10
    local iteration=0

    # Outer loop - script keeps calling AI until all done (with safety limit)
    while [ $iteration -lt $max_iterations ]; do
        ((iteration++))
        save_state "6" "execute" "$iteration"

        # Check if there are pending subtasks
        if [ "$DRY_RUN" = true ]; then
            log_info "[DRY-RUN] Executing subtasks..."
            break
        fi

        # Quick check using haiku
        local pending_check
        pending_check=$(claude --dangerously-skip-permissions --model haiku -p "Read $subtasks_file and output ONLY 'pending' if there are tasks marked [ ], or 'done' if all are [x] or [!]. One word only." 2>/dev/null | tr '[:upper:]' '[:lower:]' | grep -o -E '(pending|done)' | head -1)

        if [ "$pending_check" = "done" ]; then
            log_success "All sub-tasks completed!"
            break
        fi

        log_info "Executing subtasks (iteration $iteration of $max_iterations)..."

        local context_instruction
        context_instruction=$(build_context_instruction "read_write")

        local exec_prompt="You are implementing sub-tasks for a WhatsApp Web business platform.

TASKS FILE: $subtasks_file
LOG FILE: $log_file

$context_instruction

YOUR TASK:

1. Read context.md FIRST - it has file locations, patterns, and decisions from earlier phases
2. Read the tasks file $subtasks_file
3. Find pending tasks (marked with [ ])
4. Implement AS MANY as you can in this session:
   - You decide the batch size based on complexity
   - Simple related tasks → do multiple together
   - Complex task → focus on just that one
   - For each completed task: mark [x] in $subtasks_file
   - Log what you did in $log_file
   - Update context.md with new discoveries and progress

5. If you get BLOCKED on a task:
   - Mark it with [!] in $subtasks_file
   - Document why in $log_file and context.md
   - Continue with other tasks if possible

6. When you've done a reasonable batch OR hit a good stopping point:
   - Make sure all completed work is saved
   - Update context.md ## Progress section
   - The script will check and call you again if more remain

RULES:
- Be thorough - each task should be fully done before marking [x]
- Follow existing code patterns and style
- Document everything in the log file
- Update context.md with discoveries and progress
- It's OK to stop after a batch - script will loop

Start implementing now."

        run_cyolo "$exec_prompt" "Executing subtasks..."

        # Small delay before next check
        sleep 2
    done

    if [ $iteration -ge $max_iterations ]; then
        log_warn "Max iterations ($max_iterations) reached - some tasks may be incomplete or require manual work"
    fi

    log_success "Sub-tasks execution completed"
}

# =============================================================================
# Phase 7: Code Review (with safety loop)
# =============================================================================
phase_code_review() {
    log_step "Phase 7: Code review..."

    local work_dir="$LOOP_DIR/$CURRENT_SLUG"
    local specs_file="$work_dir/specs.md"
    local subtasks_file="$work_dir/subtasks.md"
    local review_file="$work_dir/code-review.md"
    local max_iterations=5
    local iteration=0

    # Check if there are any changes to review
    local changes_count
    changes_count=$(git diff main --name-only 2>/dev/null | wc -l | tr -d ' ')

    if [ "$changes_count" = "0" ]; then
        log_info "No code changes to review - auto-approved"
        mkdir -p "$work_dir"
        echo -e "# Code Review\n\n## Verdict: APPROVED\n\nNo code changes detected." > "$review_file"
        return 0
    fi

    while [ $iteration -lt $max_iterations ]; do
        ((iteration++))
        save_state "7" "code-review" "$iteration"

        # Check if already approved
        if [ -f "$review_file" ]; then
            local status
            status=$(claude --dangerously-skip-permissions --model haiku -p "Read $review_file and output ONLY 'approved' if verdict is APPROVED, or 'pending' otherwise. One word only." 2>/dev/null | tr '[:upper:]' '[:lower:]' | grep -o -E '(approved|pending)' | head -1)
            if [ "$status" = "approved" ]; then
                log_success "Code review APPROVED"
                return 0
            fi
        fi

        log_info "Code review iteration $iteration of $max_iterations..."

        local context_instruction
        context_instruction=$(build_context_instruction "read_write")

        local review_prompt="You are reviewing code. Review, fix issues, then APPROVE.

REVIEW FILE: $review_file

$context_instruction

PROCESS:
1. Run: git diff main
2. Check for: code quality, error handling, security, performance
3. If issues: fix them, then approve
4. Write to $review_file: '## Verdict: APPROVED' with summary

Fix issues yourself rather than just listing them. Approve when ready."

        run_cyolo "$review_prompt" "Reviewing code..."
        sleep 2
    done

    log_warn "Max iterations ($max_iterations) reached, proceeding anyway"
    log_success "Code review completed"
}

# =============================================================================
# Phase: Testing (with safety loop)
# =============================================================================
phase_testing() {
    log_step "Testing: Running tests and fixing issues..."

    local work_dir="$LOOP_DIR/$CURRENT_SLUG"
    mkdir -p "$work_dir"
    local test_log="$work_dir/test-log.md"
    local max_iterations=5
    local iteration=0

    if [ "$DRY_RUN" = true ]; then
        log_info "[DRY-RUN] Running tests..."
        log_success "All tests passed!"
        return 0
    fi

    while [ $iteration -lt $max_iterations ]; do
        ((iteration++))
        save_state "testing" "testing" "$iteration"

        # Check if already passed or blocked
        if [ -f "$test_log" ]; then
            local status
            status=$(claude --dangerously-skip-permissions --model haiku -p "Read $test_log and output ONLY: 'passed' if all tests passed, 'blocked' if blocked, or 'pending' if tests still failing. One word only." 2>/dev/null | tr '[:upper:]' '[:lower:]' | grep -o -E '(passed|blocked|pending)' | head -1)
            if [ "$status" = "passed" ]; then
                log_success "All tests passed!"
                return 0
            fi
            if [ "$status" = "blocked" ]; then
                log_warn "Testing blocked - see $test_log for details"
                return 1
            fi
        fi

        log_info "Testing iteration $iteration of $max_iterations..."

        local context_instruction
        context_instruction=$(build_context_instruction "read_write")

        local test_prompt="You are running tests. Run tests, fix failures, confirm pass.

TEST LOG: $test_log

$context_instruction

TEST COMMANDS:
- Backend: cd apps/api && bun test
- Go services: cd services/whatsapp && go test ./... and cd services/orchestrator && go test ./...

PROCESS:
1. Check changed files: git diff main --name-only
2. Run relevant tests (apps/api/* → bun test, services/* → go test)
3. If fail: fix the code and re-run
4. Write to $test_log: 'ALL TESTS PASSED' or 'BLOCKED: <reason>'

Skip E2E tests. Fix failures yourself."

        run_cyolo "$test_prompt" "Running tests..."
        sleep 2
    done

    log_warn "Max iterations ($max_iterations) reached, proceeding anyway"
    log_success "Testing phase completed"
}

# =============================================================================
# Phase: Direct Fix (for light workflows - bug/chore)
# =============================================================================
phase_direct_fix() {
    log_step "Direct Fix: Implementing task directly..."

    local work_dir="$LOOP_DIR/$CURRENT_SLUG"
    mkdir -p "$work_dir"

    local log_file="$work_dir/execution-log.md"

    save_state "direct-fix" "direct-fix"

    # Initialize log
    cat > "$log_file" << EOF
# Execution Log: $CURRENT_SLUG
Type: $CURRENT_TASK_TYPE (light workflow)
Started: $(date)

EOF

    local context_instruction
    context_instruction=$(build_context_instruction "read_write")

    local fix_prompt="You are fixing a $CURRENT_TASK_TYPE in a WhatsApp Web business platform.

TASK: $CURRENT_TASK
TYPE: $CURRENT_TASK_TYPE

PROJECT CONTEXT:
- Multi-tenant WhatsApp Web business messaging platform
- Go services (whatsapp, orchestrator) + TypeScript (Hono API, React frontend)
- See CLAUDE.md for architecture details

$context_instruction

YOUR TASK:
1. Read context.md if it exists (may have prior discoveries)
2. Analyze the task and understand what needs to be done
3. Research the codebase to find relevant files
4. Update context.md with discoveries (files found, patterns identified)
5. Make the necessary changes to fix/implement the task
6. Run relevant tests to verify the fix works
7. Document what you did in: $log_file
8. Update context.md ## Progress with completion status

RULES:
- Focus on the specific task, don't over-engineer
- Follow existing code patterns and style
- Ensure the fix is complete and tested
- Keep changes minimal and focused
- Document discoveries in context.md for future reference

IMPORTANT: Start working on this task now. Document your progress in the log file and context.md."

    run_cyolo "$fix_prompt" "Implementing direct fix..."

    echo "" >> "$log_file"
    echo "Completed: $(date)" >> "$log_file"

    log_success "Direct fix completed"
}

# =============================================================================
# Phase 8: Create PR and Merge
# =============================================================================
phase_create_pr_and_merge() {
    log_step "Creating PR and merging..."

    local work_dir="$LOOP_DIR/$CURRENT_SLUG"
    local branch_name="improvement/$CURRENT_SLUG"
    local skip_merge_flag="$SKIP_MERGE"

    save_state "8" "pr-merge"

    local pr_prompt="You are creating a git commit, PR, and merging for the completed work.

WORK DIRECTORY: $work_dir
BRANCH: $branch_name
TASK: $CURRENT_TASK
SKIP_MERGE: $skip_merge_flag

YOUR TASK:

1. STAGE & COMMIT:
   - Run: git add -A
   - Check if there are changes: git diff --cached --stat
   - If no changes, say 'No changes to commit' and stop
   - Create commit: git commit -m \"<type>(<scope>): <description>\"
     Types: feat, fix, refactor, perf, test, docs

2. PUSH:
   - Push: git push -u origin $branch_name
   - If push fails (rejected), pull and retry

3. CREATE PR:
   - Check if PR exists: gh pr list --head \"$branch_name\"
   - If no PR, create one with gh pr create

4. MERGE (only if SKIP_MERGE is 'false'):
   - Check CI status: gh pr checks
   - If CI is running, wait and check again (up to 5 minutes)
   - If CI passed, merge: gh pr merge --squash --delete-branch
   - If CI failed, report the failure but don't merge
   - If merge fails due to conflicts, try to resolve or report

HANDLE ERRORS:
- If any step fails, try to fix it and retry
- If push is rejected, fetch and rebase first
- If merge has conflicts, attempt to resolve them
- Report any unrecoverable errors clearly

Run these commands now."

    run_cyolo "$pr_prompt" "Creating PR and merging..."

    log_success "PR phase completed for branch: $branch_name"

    # Cleanup worktree if we used one
    cleanup_worktree
}

# =============================================================================
# Workflow: FULL (for features)
# Requirements → Review → Specs → Review → Subtasks → Execute → Code Review → Merge
# =============================================================================
workflow_full() {
    local start_phase="${1:-1}"

    log_info "Running FULL workflow (feature)"

    # Create branch
    if [ "$start_phase" -le 1 ]; then
        create_branch
    fi

    # Phase 1: Requirements
    if [ "$start_phase" -le 1 ]; then
        phase_requirements
    fi

    # Phase 2: Review Requirements
    if [ "$start_phase" -le 2 ]; then
        phase_review_requirements
    fi

    # Phase 3: Specifications
    if [ "$start_phase" -le 3 ]; then
        phase_specs
    fi

    # Phase 4: Review Specifications
    if [ "$start_phase" -le 4 ]; then
        phase_review_specs
    fi

    # Phase 5: Sub-Tasks
    if [ "$start_phase" -le 5 ]; then
        phase_subtasks
    fi

    # Phase 6: Execute
    if [ "$start_phase" -le 6 ]; then
        phase_execute
    fi

    # Phase 7: Code Review
    if [ "$start_phase" -le 7 ]; then
        phase_code_review
    fi

    # Phase 8: Testing
    phase_testing

    # Phase 9: Create PR and Merge
    phase_create_pr_and_merge
}

# =============================================================================
# Workflow: MEDIUM (for refactors)
# Requirements → Subtasks → Execute → Code Review → Testing → Merge
# (skips requirement review and specs)
# =============================================================================
workflow_medium() {
    local start_phase="${1:-1}"

    log_info "Running MEDIUM workflow (refactor)"

    # Create branch
    if [ "$start_phase" -le 1 ]; then
        create_branch
    fi

    # Phase 1: Requirements (brief, no review)
    if [ "$start_phase" -le 1 ]; then
        phase_requirements
    fi

    # Skip requirement review and specs for refactors

    # Phase 5: Sub-Tasks
    if [ "$start_phase" -le 5 ]; then
        phase_subtasks
    fi

    # Phase 6: Execute
    if [ "$start_phase" -le 6 ]; then
        phase_execute
    fi

    # Phase 7: Code Review
    if [ "$start_phase" -le 7 ]; then
        phase_code_review
    fi

    # Phase 8: Testing
    phase_testing

    # Phase 9: Create PR and Merge
    phase_create_pr_and_merge
}

# =============================================================================
# Workflow: LIGHT (for bugs/chores)
# Direct Fix → Code Review → Testing → Merge
# =============================================================================
workflow_light() {
    local start_phase="${1:-1}"

    log_info "Running LIGHT workflow (bug/chore)"

    # Create branch
    create_branch

    # Direct fix
    if [ "$start_phase" != "code-review" ] && [ "$start_phase" != "testing" ]; then
        phase_direct_fix
    fi

    # Code Review
    if [ "$start_phase" != "testing" ]; then
        phase_code_review
    fi

    # Testing
    phase_testing

    # Create PR and Merge
    phase_create_pr_and_merge
}

# =============================================================================
# Workflow: MINIMAL (for docs)
# Direct Fix → Testing → Merge (no code review)
# =============================================================================
workflow_minimal() {
    log_info "Running MINIMAL workflow (docs)"

    # Create branch
    create_branch

    # Direct fix
    phase_direct_fix

    # Skip code review for docs

    # Testing (still run tests to catch any issues)
    phase_testing

    # Create PR and Merge
    phase_create_pr_and_merge
}

# =============================================================================
# Run Task Workflow (routes to appropriate workflow based on type)
# =============================================================================
run_task_workflow() {
    local start_phase="${1:-1}"

    # Show task summary (truncate long tasks)
    local task_summary
    task_summary=$(echo "$CURRENT_TASK" | head -1 | cut -c1-80)

    log_info "=============================================="
    log_info "TASK: $task_summary"
    log_info "TYPE: $CURRENT_TASK_TYPE"
    log_info "SLUG: $CURRENT_SLUG"
    log_info "=============================================="

    # Initialize shared context file for this task
    init_context

    # Helper to ensure we're on the correct branch for resume
    ensure_branch() {
        local branch_name="improvement/$CURRENT_SLUG"
        if git show-ref --verify --quiet "refs/heads/$branch_name"; then
            log_info "Checking out branch: $branch_name"
            git checkout "$branch_name" 2>/dev/null || true
        else
            log_warn "Branch $branch_name not found, staying on current branch"
        fi
    }

    # Handle special resume phases that skip to specific points
    if [ "$start_phase" = "testing" ]; then
        log_info "Resuming from testing phase..."
        ensure_branch
        phase_testing
        phase_create_pr_and_merge
        return
    fi

    if [ "$start_phase" = "code-review" ] || [ "$start_phase" = "7" ]; then
        log_info "Resuming from code-review phase..."
        ensure_branch
        phase_code_review
        phase_testing
        phase_create_pr_and_merge
        return
    fi

    if [ "$start_phase" = "direct-fix" ]; then
        log_info "Resuming from direct-fix phase..."
        ensure_branch
        phase_direct_fix
        phase_code_review
        phase_testing
        phase_create_pr_and_merge
        return
    fi

    case "$CURRENT_TASK_TYPE" in
        "feature")
            workflow_full "$start_phase"
            ;;
        "refactor")
            workflow_medium "$start_phase"
            ;;
        "bug"|"chore")
            workflow_light "$start_phase"
            ;;
        "docs")
            workflow_minimal
            ;;
        *)
            log_warn "Unknown task type: $CURRENT_TASK_TYPE, using FULL workflow"
            workflow_full "$start_phase"
            ;;
    esac

    log_success "=============================================="
    log_success "TASK COMPLETED: $task_summary"
    log_success "=============================================="
}

# =============================================================================
# Main
# =============================================================================
main() {
    parse_args "$@"

    log_info "Agent Loop Starting (Fully Autonomous)"
    log_info "Auto-merge: $( [ "$SKIP_MERGE" = true ] && echo 'disabled' || echo 'enabled (squash)' )"
    if [ "$RESUME_MODE" = true ]; then
        log_info "Mode: RESUME"
    fi
    echo ""

    mkdir -p "$LOOP_DIR"

    # Handle resume mode
    if [ "$RESUME_MODE" = true ]; then
        # load_state sets global variables directly (no subshell)
        load_state

        # Convert phase string to number
        local start_phase=1
        case "$LOADED_PHASE" in
            "1"|"requirements") start_phase=1 ;;
            "2"|"requirements-review") start_phase=2 ;;
            "3"|"specs") start_phase=3 ;;
            "4"|"specs-review") start_phase=4 ;;
            "5"|"subtasks") start_phase=5 ;;
            "6"|"execute") start_phase=6 ;;
            "7"|"code-review") start_phase=7 ;;
            "testing") start_phase="testing" ;;
            "8"|"pr-merge") start_phase=8 ;;
            "direct-fix") start_phase="direct-fix" ;;
            *) start_phase=1 ;;
        esac

        log_info "Resuming from phase $start_phase ($LOADED_PHASE)"
        run_task_workflow "$start_phase"

        # After completing resumed task, mark it and continue
        mark_task_complete "$TASKS_FILE" "$CURRENT_TASK_INDEX"
        clear_state

        # Check input format to decide whether to continue or exit
        local input_format
        input_format=$(detect_input_format "$TASKS_FILE")

        if [ "$input_format" = "feature" ]; then
            # Single feature file - we're done after resume completes
            log_success "=============================================="
            log_success "Agent Loop Finished!"
            log_success "Feature completed via resume!"
            log_success "=============================================="
            exit 0
        fi

        # Checklist format - sync and continue with remaining tasks
        sync_main
    fi

    # Detect input format
    local input_format
    input_format=$(detect_input_format "$TASKS_FILE")
    log_info "Input format detected: $input_format"

    if [ "$input_format" = "feature" ]; then
        # Single feature/requirement - run once
        log_info "Processing as single feature/requirement..."

        CURRENT_TASK=$(get_feature_task "$TASKS_FILE")
        CURRENT_TASK_INDEX=0

        if [ -z "$CURRENT_TASK" ]; then
            log_error "Empty input file: $TASKS_FILE"
            exit 1
        fi

        log_info "=============================================="
        log_info "Feature: $(echo "$CURRENT_TASK" | head -1)"
        log_info "=============================================="

        # Classify task type
        CURRENT_TASK_TYPE=$(classify_task "$CURRENT_TASK")

        # Generate slug
        CURRENT_SLUG=$(generate_slug "$CURRENT_TASK")
        log_info "Generated slug: $CURRENT_SLUG"

        # Save initial state
        save_state "0" "starting" "0"

        # Run workflow
        run_task_workflow 1

        # Clear state
        clear_state

        log_success "Feature completed!"

    else
        # Checklist format - loop through tasks
        log_info "Processing as task checklist..."

        local tasks_completed=0

        while true; do
            # Sync with main before starting each task
            if [ $tasks_completed -gt 0 ] || [ "$RESUME_MODE" = true ]; then
                sync_main
            fi

            # Get next task
            local next_task_info
            next_task_info=$(get_next_task "$TASKS_FILE")

            if [ -z "$next_task_info" ]; then
                log_success "All tasks completed!"
                break
            fi

            # Parse task info
            CURRENT_TASK_INDEX=$(echo "$next_task_info" | cut -d'|' -f1)
            CURRENT_TASK=$(echo "$next_task_info" | cut -d'|' -f2-)

            local remaining
            remaining=$(count_remaining_tasks "$TASKS_FILE")
            log_info "=============================================="
            log_info "Starting task ($remaining remaining): $CURRENT_TASK"
            log_info "=============================================="

            # Classify task type (using Haiku - fast/cheap)
            CURRENT_TASK_TYPE=$(classify_task "$CURRENT_TASK")

            # Generate slug for this task
            CURRENT_SLUG=$(generate_slug "$CURRENT_TASK")
            log_info "Generated slug: $CURRENT_SLUG"

            # Save initial state
            save_state "0" "starting" "0"

            # Run the appropriate workflow based on task type
            run_task_workflow 1

            # Mark task as complete in original file
            mark_task_complete "$TASKS_FILE" "$CURRENT_TASK_INDEX"

            # Clear state after successful completion
            clear_state

            ((tasks_completed++))

            log_success "Task completed and merged. Moving to next task..."
            echo ""
        done
    fi

    echo ""
    log_success "=============================================="
    log_success "Agent Loop Finished!"
    log_success "Total tasks completed: $tasks_completed"
    log_success "=============================================="
}

main "$@"
