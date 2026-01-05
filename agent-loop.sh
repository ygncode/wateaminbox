#!/bin/bash

# =============================================================================
# Agent Loop - Autonomous AI-driven code workflow
# =============================================================================
#
# Usage: ./agent-loop.sh <prompt.md> [OPTIONS]
#
# Options:
#   --max-cycles N          Max full workflow cycles (default: 1)
#   --max-review-iters N    Max review iterations per phase (default: 3)
#   --dry-run               Print commands without executing
#   --resume                Resume from saved state
#   --verbose               Show detailed output
#
# Workflow:
#   1. Read prompt.md → Generate requirement.md (with review loop)
#   2. Requirement approved → Generate specs.md (with review loop)
#   3. Specs approved → Generate tasks.md
#   4. Execute tasks one by one (with code review loop)
#   5. All tasks done → Create single branch and PR
#
# =============================================================================

set -e

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
PROMPT_FILE=""
MAX_CYCLES=1
MAX_REVIEW_ITERS=3
DRY_RUN=false
RESUME_MODE=false
VERBOSE=false

# State tracking
CURRENT_CYCLE=0
CURRENT_SLUG=""

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
            --max-cycles)
                MAX_CYCLES="$2"
                shift 2
                ;;
            --max-review-iters)
                MAX_REVIEW_ITERS="$2"
                shift 2
                ;;
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
                if [ -z "$PROMPT_FILE" ]; then
                    PROMPT_FILE="$1"
                fi
                shift
                ;;
        esac
    done

    if [ -z "$PROMPT_FILE" ] && [ "$RESUME_MODE" != true ]; then
        log_error "Prompt file required. Usage: $0 <prompt.md> [OPTIONS]"
        exit 1
    fi
}

show_help() {
    cat << 'EOF'
Agent Loop - Autonomous AI-driven code workflow

Usage: ./agent-loop.sh <prompt.md> [OPTIONS]

Arguments:
  prompt.md               Path to the prompt file describing the task

Options:
  --max-cycles N          Max full workflow cycles (default: 1)
  --max-review-iters N    Max review iterations per phase (default: 3)
  --dry-run               Print commands without executing
  --resume                Resume from saved state in .loop/state.json
  --verbose               Show detailed output
  -h, --help              Show this help message

Workflow:
  1. Read prompt → Generate requirement.md (with review loop)
  2. Requirement approved → Generate specs.md (with review loop)
  3. Specs approved → Generate tasks.md
  4. Execute tasks one by one (with code review loop)
  5. Create single branch and PR at the end

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

# Run cyolo (Claude with opus model)
run_cyolo() {
    local prompt="$1"
    local description="${2:-Running agent}"

    log_agent "$description"

    if [ "$DRY_RUN" = true ]; then
        echo "[DRY-RUN] claude --dangerously-skip-permissions --model opus -p <prompt>" >&2
        return 0
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

    claude --dangerously-skip-permissions --model opus -p "$prompt" >&2
}

# Run cyolo with prompt from file
run_cyolo_file() {
    local prompt_file="$1"
    local description="${2:-Running agent}"

    run_cyolo "$(cat "$prompt_file")" "$description"
}

# Run command (for git, etc.)
run_cmd() {
    if [ "$DRY_RUN" = true ]; then
        echo "[DRY-RUN] $*" >&2
        return 0
    fi
    "$@"
}

# Generate slug from prompt content
generate_slug() {
    local prompt_content="$1"
    local slug_file="$LOOP_DIR/.slug-temp.txt"
    local prompt

    prompt="Analyze this task description and generate a short, descriptive slug (kebab-case, 2-4 words).
Examples: 'api-rate-limiting', 'contact-sync-fix', 'websocket-reconnect', 'message-delivery-timeout'

Task description:
$prompt_content

Output ONLY the slug, nothing else. No explanation, no quotes, just the slug."

    if [ "$DRY_RUN" = true ]; then
        echo "dry-run-slug"
        return
    fi

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
  "prompt_file": "$PROMPT_FILE",
  "slug": "$CURRENT_SLUG",
  "cycle": $CURRENT_CYCLE,
  "phase": "$phase",
  "phase_name": "$phase_name",
  "review_iteration": $review_iter,
  "last_updated": "$(date -Iseconds)"
}
EOF
    log_verbose "State saved: phase=$phase ($phase_name), cycle=$CURRENT_CYCLE, slug=$CURRENT_SLUG"
}

load_state() {
    if [ ! -f "$STATE_FILE" ]; then
        log_error "No state file found at $STATE_FILE"
        exit 1
    fi

    PROMPT_FILE=$(grep '"prompt_file"' "$STATE_FILE" | cut -d'"' -f4)
    CURRENT_SLUG=$(grep '"slug"' "$STATE_FILE" | cut -d'"' -f4)
    CURRENT_CYCLE=$(grep '"cycle"' "$STATE_FILE" | grep -o '[0-9]*' | head -1)

    local phase
    phase=$(grep '"phase"' "$STATE_FILE" | cut -d'"' -f4)
    local phase_name
    phase_name=$(grep '"phase_name"' "$STATE_FILE" | cut -d'"' -f4)

    log_success "State loaded: phase=$phase ($phase_name), cycle=$CURRENT_CYCLE, slug=$CURRENT_SLUG"
    echo "$phase"
}

clear_state() {
    rm -f "$STATE_FILE"
    log_verbose "State cleared"
}

# =============================================================================
# Phase 1: Generate Requirements
# =============================================================================
phase_requirements() {
    log_step "Phase 1: Generating requirements..."

    local prompt_content
    prompt_content=$(cat "$PROMPT_FILE")

    local work_dir="$LOOP_DIR/$CURRENT_SLUG"
    mkdir -p "$work_dir"

    local req_file="$work_dir/requirement.md"
    local prompt

    prompt="You are analyzing a task and creating a detailed requirements document.

PROJECT CONTEXT:
- This is a WhatsApp Web business messaging platform
- Multi-tenant architecture with PostgreSQL
- Go services (whatsapp, orchestrator) + TypeScript (Hono API, React frontend)
- See CLAUDE.md for full architecture details

USER TASK:
$prompt_content

YOUR TASK:
1. Analyze the task thoroughly
2. Research the codebase to understand current state
3. Create a comprehensive requirements document at: $req_file

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

IMPORTANT: Write the file now. Be thorough and specific."

    run_cyolo "$prompt" "Generating requirements..."
    save_state "1" "requirements"

    if [ ! -f "$req_file" ]; then
        log_error "Requirements file was not created: $req_file"
        return 1
    fi

    log_success "Requirements generated: $req_file"
}

# =============================================================================
# Phase 2: Review Requirements
# =============================================================================
phase_review_requirements() {
    log_step "Phase 2: Reviewing requirements..."

    local work_dir="$LOOP_DIR/$CURRENT_SLUG"
    local req_file="$work_dir/requirement.md"
    local review_file="$work_dir/requirement-review.md"

    local iteration=0
    while [ $iteration -lt $MAX_REVIEW_ITERS ]; do
        ((iteration++))
        log_review "Review iteration $iteration/$MAX_REVIEW_ITERS"
        save_state "2" "requirements-review" "$iteration"

        local req_content
        req_content=$(cat "$req_file")

        local review_prompt="You are a senior architect reviewing requirements for quality and completeness.

REQUIREMENTS TO REVIEW:
$req_content

REVIEW CRITERIA:
1. Scalability - Will this scale with the system?
2. Maintainability - Is this easy to maintain long-term?
3. Security - Are there security implications?
4. Completeness - Are all edge cases considered?
5. Clarity - Are requirements clear and testable?
6. Feasibility - Is this technically achievable?

YOUR TASK:
1. Analyze the requirements critically
2. Write your review to: $review_file

FORMAT for $review_file:
# Requirements Review

## Verdict: APPROVED | NEEDS_REVISION

## Strengths
- <what's good>

## Issues Found

### Critical (Must Fix)
- [ ] <issue and suggested fix>

### Suggestions (Nice to Have)
- [ ] <improvement suggestion>

## Summary
<overall assessment>

If verdict is NEEDS_REVISION, be specific about what needs to change.
If verdict is APPROVED, confirm the requirements are ready for specs.

IMPORTANT: Write the file now."

        run_cyolo "$review_prompt" "Reviewing requirements (iteration $iteration)..."

        if [ ! -f "$review_file" ]; then
            log_warn "Review file not created, assuming APPROVED"
            break
        fi

        if grep -q "APPROVED" "$review_file"; then
            log_success "Requirements APPROVED"
            break
        fi

        if [ $iteration -lt $MAX_REVIEW_ITERS ]; then
            log_warn "Requirements need revision, updating..."

            local revision_prompt="You are revising requirements based on review feedback.

CURRENT REQUIREMENTS:
$(cat "$req_file")

REVIEW FEEDBACK:
$(cat "$review_file")

YOUR TASK:
1. Address ALL critical issues from the review
2. Consider suggestions where appropriate
3. Update the requirements file: $req_file
4. Mark addressed items as [x] in: $review_file

IMPORTANT: Update both files now."

            run_cyolo "$revision_prompt" "Revising requirements..."
        fi
    done

    if [ $iteration -ge $MAX_REVIEW_ITERS ] && grep -q "NEEDS_REVISION" "$review_file" 2>/dev/null; then
        log_warn "Max review iterations reached, proceeding anyway"
    fi
}

# =============================================================================
# Phase 3: Generate Specifications
# =============================================================================
phase_specs() {
    log_step "Phase 3: Generating specifications..."

    local work_dir="$LOOP_DIR/$CURRENT_SLUG"
    local req_file="$work_dir/requirement.md"
    local specs_file="$work_dir/specs.md"

    save_state "3" "specs"

    local req_content
    req_content=$(cat "$req_file")

    local specs_prompt="You are a senior software architect creating detailed technical specifications.

REQUIREMENTS:
$req_content

YOUR TASK:
1. Analyze the requirements
2. Research the codebase to understand implementation context
3. Create detailed technical specifications at: $specs_file

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

IMPORTANT: Write the file now. Be thorough but practical."

    run_cyolo "$specs_prompt" "Generating specifications..."

    if [ ! -f "$specs_file" ]; then
        log_error "Specs file was not created: $specs_file"
        return 1
    fi

    log_success "Specifications generated: $specs_file"
}

# =============================================================================
# Phase 4: Review Specifications
# =============================================================================
phase_review_specs() {
    log_step "Phase 4: Reviewing specifications..."

    local work_dir="$LOOP_DIR/$CURRENT_SLUG"
    local specs_file="$work_dir/specs.md"
    local review_file="$work_dir/specs-review.md"

    local iteration=0
    while [ $iteration -lt $MAX_REVIEW_ITERS ]; do
        ((iteration++))
        log_review "Review iteration $iteration/$MAX_REVIEW_ITERS"
        save_state "4" "specs-review" "$iteration"

        local specs_content
        specs_content=$(cat "$specs_file")

        local review_prompt="You are a senior architect reviewing technical specifications.

SPECIFICATIONS TO REVIEW:
$specs_content

REVIEW CRITERIA:
1. Technical Accuracy - Is the approach correct?
2. Completeness - Are all requirements addressed?
3. Code Quality - Will this produce maintainable code?
4. Performance - Are there performance concerns?
5. Security - Are there security issues?
6. Testing - Is testing strategy adequate?

YOUR TASK:
1. Analyze the specifications critically
2. Write your review to: $review_file

FORMAT for $review_file:
# Specifications Review

## Verdict: APPROVED | NEEDS_REVISION

## Strengths
- <what's good>

## Issues Found

### Critical (Must Fix)
- [ ] <issue and suggested fix>

### Suggestions
- [ ] <improvement suggestion>

## Summary
<overall assessment>

IMPORTANT: Write the file now."

        run_cyolo "$review_prompt" "Reviewing specifications (iteration $iteration)..."

        if [ ! -f "$review_file" ]; then
            log_warn "Review file not created, assuming APPROVED"
            break
        fi

        if grep -q "APPROVED" "$review_file"; then
            log_success "Specifications APPROVED"
            break
        fi

        if [ $iteration -lt $MAX_REVIEW_ITERS ]; then
            log_warn "Specifications need revision, updating..."

            local revision_prompt="You are revising specifications based on review feedback.

CURRENT SPECIFICATIONS:
$(cat "$specs_file")

REVIEW FEEDBACK:
$(cat "$review_file")

YOUR TASK:
1. Address ALL critical issues from the review
2. Consider suggestions where appropriate
3. Update the specifications file: $specs_file
4. Mark addressed items as [x] in: $review_file

IMPORTANT: Update both files now."

            run_cyolo "$revision_prompt" "Revising specifications..."
        fi
    done
}

# =============================================================================
# Phase 5: Generate Tasks
# =============================================================================
phase_tasks() {
    log_step "Phase 5: Generating tasks..."

    local work_dir="$LOOP_DIR/$CURRENT_SLUG"
    local req_file="$work_dir/requirement.md"
    local specs_file="$work_dir/specs.md"
    local tasks_file="$work_dir/tasks.md"

    save_state "5" "tasks"

    local tasks_prompt="You are a project manager breaking down technical work into actionable tasks.

REQUIREMENTS:
$(cat "$req_file")

SPECIFICATIONS:
$(cat "$specs_file")

YOUR TASK:
Create a detailed task list at: $tasks_file

FORMAT:
# Tasks: <Title>

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
5. Be specific about files and changes

IMPORTANT: Write the file now."

    run_cyolo "$tasks_prompt" "Generating tasks..."

    if [ ! -f "$tasks_file" ]; then
        log_error "Tasks file was not created: $tasks_file"
        return 1
    fi

    log_success "Tasks generated: $tasks_file"
}

# =============================================================================
# Phase 6: Execute Tasks
# =============================================================================
phase_execute() {
    log_step "Phase 6: Executing tasks..."

    local work_dir="$LOOP_DIR/$CURRENT_SLUG"
    local tasks_file="$work_dir/tasks.md"
    local log_file="$work_dir/execution-log.md"

    # Initialize log
    cat > "$log_file" << EOF
# Execution Log: $CURRENT_SLUG

Started: $(date)

EOF

    local max_task_iterations=50
    local iteration=0

    while [ $iteration -lt $max_task_iterations ]; do
        ((iteration++))
        save_state "6" "execute" "$iteration"

        # Check for pending tasks
        local has_pending
        has_pending=$(check_pending_tasks "$tasks_file")

        if [ "$has_pending" = "done" ]; then
            log_success "All tasks completed!"
            break
        fi

        log_info "Task execution iteration $iteration..."

        local exec_prompt="You are implementing tasks for a WhatsApp Web business platform.

TASKS FILE: $tasks_file
LOG FILE: $log_file

YOUR TASK:
1. Read the tasks file
2. Find the FIRST pending/incomplete task (marked with [ ])
3. Implement it completely:
   - Write/modify the necessary code
   - Add appropriate tests if specified
   - Ensure code compiles/runs
4. Update $tasks_file:
   - Change [ ] to [x] for the completed task
5. Append to $log_file:
   - What you did
   - Files modified
   - Any issues encountered

RULES:
- Complete ONLY ONE task per execution
- Be thorough - the task should be fully done
- Follow existing code patterns and style
- If blocked, mark with [!] and document why

If ALL tasks are already completed, just say 'All tasks done' and exit.
Otherwise, start working on the first pending task now."

        run_cyolo "$exec_prompt" "Executing task (iteration $iteration)..."

        sleep 2
    done

    echo "" >> "$log_file"
    echo "Completed: $(date)" >> "$log_file"
}

# Check pending tasks using haiku (fast/cheap)
check_pending_tasks() {
    local tasks_file="$1"

    if [ "$DRY_RUN" = true ]; then
        echo "pending"
        return
    fi

    local check_prompt="Read this tasks file and check if there are any pending tasks.
Look for tasks marked with [ ] (unchecked).
Ignore tasks marked with [x] (completed) or [!] (blocked).

Tasks file content:
$(cat "$tasks_file")

Output ONLY one word: 'pending' or 'done'. Nothing else."

    local result
    result=$(claude --dangerously-skip-permissions --model haiku -p "$check_prompt" 2>/dev/null | tr '[:upper:]' '[:lower:]' | grep -o -E '(pending|done)' | head -1)

    echo "${result:-pending}"
}

# =============================================================================
# Phase 7: Code Review
# =============================================================================
phase_code_review() {
    log_step "Phase 7: Code review..."

    local work_dir="$LOOP_DIR/$CURRENT_SLUG"
    local specs_file="$work_dir/specs.md"
    local tasks_file="$work_dir/tasks.md"
    local review_file="$work_dir/code-review.md"

    local iteration=0
    while [ $iteration -lt $MAX_REVIEW_ITERS ]; do
        ((iteration++))
        log_review "Code review iteration $iteration/$MAX_REVIEW_ITERS"
        save_state "7" "code-review" "$iteration"

        local review_prompt="You are a senior code reviewer evaluating implemented changes.

SPECIFICATIONS:
$(cat "$specs_file" | head -150)

TASKS:
$(cat "$tasks_file")

YOUR TASK:
1. Run 'git diff HEAD~20' to review all code changes
2. Run tests to verify functionality
3. Check for:
   - Code quality issues
   - Missing error handling
   - Security concerns
   - Performance issues
   - Missing tests
   - Incomplete implementations

4. Write a review document to: $review_file

FORMAT for $review_file:
# Code Review: $CURRENT_SLUG

## Verdict: APPROVED | NEEDS_CHANGES

## Changes Reviewed
- <list of files reviewed>

## What Was Done Well
- <positive feedback>

## Issues Found

### Critical (Must Fix)
- [ ] <issue description>
  - File: <path>
  - Line: <if applicable>
  - Fix: <suggested fix>

### Minor (Nice to Fix)
- [ ] <issue description>

## Test Results
<output of test runs>

## Summary
<overall assessment>

If NEEDS_CHANGES, be specific about fixes needed.
If APPROVED, confirm the code is ready for PR."

        run_cyolo "$review_prompt" "Reviewing code (iteration $iteration)..."

        if [ ! -f "$review_file" ]; then
            log_warn "Review file not created, assuming APPROVED"
            break
        fi

        if grep -q "APPROVED" "$review_file"; then
            log_success "Code APPROVED"
            break
        fi

        if [ $iteration -lt $MAX_REVIEW_ITERS ]; then
            log_warn "Code needs changes, fixing..."

            # Add review issues as new tasks
            local fix_prompt="You are addressing code review feedback.

REVIEW FEEDBACK:
$(cat "$review_file")

YOUR TASK:
1. Find all unchecked items in the 'Critical (Must Fix)' section
2. Fix each issue in the code
3. Re-run affected tests
4. Update $review_file - mark fixed items as [x]

Work through ALL critical issues before stopping."

            run_cyolo "$fix_prompt" "Fixing code review issues..."
        fi
    done
}

# =============================================================================
# Phase 8: Create Branch and PR
# =============================================================================
phase_create_pr() {
    log_step "Phase 8: Creating branch and PR..."

    local work_dir="$LOOP_DIR/$CURRENT_SLUG"
    local branch_name="improvement/$CURRENT_SLUG"

    save_state "8" "pr"

    # Check if on correct branch or create it
    local current_branch
    current_branch=$(git branch --show-current 2>/dev/null || echo "")

    if [ "$current_branch" != "$branch_name" ]; then
        if git show-ref --verify --quiet "refs/heads/$branch_name"; then
            log_info "Checking out existing branch: $branch_name"
            run_cmd git checkout "$branch_name"
        else
            log_info "Creating new branch: $branch_name"
            run_cmd git checkout -b "$branch_name"
        fi
    fi

    # Stage all changes
    run_cmd git add -A

    # Check if there are changes
    if git diff --cached --quiet; then
        log_warn "No changes to commit"
        return 0
    fi

    local pr_prompt="You are creating a git commit and PR for the completed work.

WORK DIRECTORY: $work_dir
BRANCH: $branch_name

FILES IN WORK DIRECTORY:
$(ls -la "$work_dir" 2>/dev/null || echo "Directory not found")

YOUR TASK:
1. Review staged changes: git diff --cached --stat
2. Create a well-formatted commit:
   git commit -m \"<type>(<scope>): <description>\"

   Types: feat, fix, refactor, perf, test, docs

3. Push the branch:
   git push -u origin $branch_name

4. Create PR if it doesn't exist:
   Check with: gh pr list --head \"$branch_name\"

   If no PR exists, create one with:
   - Title: descriptive title based on the work
   - Body: summary of changes, link to specs in .loop/

IMPORTANT: Run these git commands now to commit, push, and create PR."

    run_cyolo "$pr_prompt" "Creating commit and PR..."

    log_success "PR created for branch: $branch_name"
}

# =============================================================================
# Main Workflow
# =============================================================================
run_workflow() {
    local start_phase="${1:-1}"

    log_info "=============================================="
    log_info "WORKFLOW: $CURRENT_SLUG (starting from phase $start_phase)"
    log_info "=============================================="

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

    # Phase 5: Tasks
    if [ "$start_phase" -le 5 ]; then
        phase_tasks
    fi

    # Phase 6: Execute
    if [ "$start_phase" -le 6 ]; then
        phase_execute
    fi

    # Phase 7: Code Review
    if [ "$start_phase" -le 7 ]; then
        phase_code_review
    fi

    # Phase 8: Create PR
    if [ "$start_phase" -le 8 ]; then
        phase_create_pr
    fi

    log_success "=============================================="
    log_success "WORKFLOW COMPLETED: $CURRENT_SLUG"
    log_success "=============================================="

    clear_state
}

# =============================================================================
# Main
# =============================================================================
main() {
    parse_args "$@"

    log_info "Agent Loop Starting"
    log_info "Max cycles: $MAX_CYCLES"
    log_info "Max review iterations: $MAX_REVIEW_ITERS"
    if [ "$RESUME_MODE" = true ]; then
        log_info "Mode: RESUME"
    fi
    echo ""

    mkdir -p "$LOOP_DIR"

    # Handle resume mode
    if [ "$RESUME_MODE" = true ]; then
        local phase
        phase=$(load_state)

        # Convert phase string to number
        local start_phase=1
        case "$phase" in
            "1"|"requirements") start_phase=1 ;;
            "2"|"requirements-review") start_phase=2 ;;
            "3"|"specs") start_phase=3 ;;
            "4"|"specs-review") start_phase=4 ;;
            "5"|"tasks") start_phase=5 ;;
            "6"|"execute") start_phase=6 ;;
            "7"|"code-review") start_phase=7 ;;
            "8"|"pr") start_phase=8 ;;
            *) start_phase=1 ;;
        esac

        log_info "Resuming from phase $start_phase ($phase)"
        run_workflow "$start_phase"
        return
    fi

    # Fresh start
    local prompt_content
    prompt_content=$(cat "$PROMPT_FILE")

    log_info "Generating slug from prompt..."
    CURRENT_SLUG=$(generate_slug "$prompt_content")
    log_success "Slug: $CURRENT_SLUG"

    # Copy prompt to work directory
    local work_dir="$LOOP_DIR/$CURRENT_SLUG"
    mkdir -p "$work_dir"
    cp "$PROMPT_FILE" "$work_dir/prompt.md"

    # Run workflow cycles
    local cycle=0
    while [ $cycle -lt $MAX_CYCLES ]; do
        ((cycle++))
        CURRENT_CYCLE=$cycle
        log_info "=============================================="
        log_info "CYCLE $cycle of $MAX_CYCLES"
        log_info "=============================================="

        run_workflow 1

        if [ $cycle -lt $MAX_CYCLES ]; then
            log_info "Cycle complete. Starting next cycle..."
            # For subsequent cycles, the agent could analyze results and create new improvements
        fi
    done

    echo ""
    log_success "Agent Loop Finished!"
    log_info "Total cycles completed: $cycle"
    log_info "Work directory: $LOOP_DIR/$CURRENT_SLUG"
    log_info "Check the PR for your changes"
}

main "$@"
