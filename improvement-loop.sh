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
    export $(grep -v '^#' "$(pwd)/.env" | xargs)
fi

# =============================================================================
# Tool Functions (replaces shell aliases which don't work in scripts)
# =============================================================================

# Gemini CLI with yolo mode
gyolo() {
    gemini --yolo "$@"
}

# Claude CLI with skip permissions
cyolo() {
    claude --dangerously-skip-permissions "$@"
}

# Claude CLI with zai backend (cheaper)
# Requires ZAI_AUTH_TOKEN environment variable
zyolo() {
    if [ -z "$ZAI_AUTH_TOKEN" ]; then
        echo "Error: ZAI_AUTH_TOKEN environment variable not set" >&2
        exit 1
    fi
    ANTHROPIC_BASE_URL="https://api.z.ai/api/anthropic" \
    ANTHROPIC_AUTH_TOKEN="$ZAI_AUTH_TOKEN" \
    claude --dangerously-skip-permissions "$@"
}

# Configuration
PROJECT_DIR="$(pwd)"
LOOP_DIR="$PROJECT_DIR/.loop"
COOLDOWN_SECONDS=300  # 5 minutes between cycles
MAX_CYCLES=-1         # -1 = unlimited
DRY_RUN=false
FOCUS_AREA=""         # Empty = auto-detect each cycle
FOCUS_HISTORY_FILE="$LOOP_DIR/focus-history.md"

# Track state
CURRENT_CYCLE=0
PREVIOUS_BRANCH="main"
CYCLE_LETTERS=({a..z})

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
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--max-cycles N] [--dry-run] [--focus \"area\"]"
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

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "${PURPLE}[STEP]${NC} $1"; }
log_agent() { echo -e "${CYAN}[$1]${NC} $2"; }

run_cmd() {
    if [ "$DRY_RUN" = true ]; then
        echo "[DRY-RUN] $*"
    else
        eval "$@"
    fi
}

# Initialize loop directory
init_loop_dir() {
    mkdir -p "$LOOP_DIR"
    log_info "Loop directory: $LOOP_DIR"
}

# Get cycle letter (a, b, c, ...)
get_cycle_letter() {
    local idx=$1
    if [ $idx -lt 26 ]; then
        echo "${CYCLE_LETTERS[$idx]}"
    else
        # After z, use aa, ab, etc.
        local first=$((idx / 26 - 1))
        local second=$((idx % 26))
        echo "${CYCLE_LETTERS[$first]}${CYCLE_LETTERS[$second]}"
    fi
}

# Clean up old loop files for new cycle
cleanup_loop_files() {
    local slug=$1
    log_info "Cleaning up previous loop state for new cycle..."
}

# =============================================================================
# PHASE 0: Determine Focus Area (cyolo/Claude)
# =============================================================================
phase_determine_focus() {
    local cycle_letter=$1
    log_step "Phase 0: Determining focus area with Claude..."
    
    local focus_file="$LOOP_DIR/focus-${cycle_letter}.md"
    
    # Initialize focus history if it doesn't exist
    if [ ! -f "$FOCUS_HISTORY_FILE" ]; then
        echo "# Focus Area History" > "$FOCUS_HISTORY_FILE"
        echo "" >> "$FOCUS_HISTORY_FILE"
        echo "Tracks which areas have been focused on to ensure variety." >> "$FOCUS_HISTORY_FILE"
        echo "" >> "$FOCUS_HISTORY_FILE"
    fi
    
    run_cmd cyolo --model sonnet -p "
You are analyzing a WhatsApp Web business messaging platform to determine where to focus improvement efforts.

PROJECT STRUCTURE:
- services/whatsapp/ - Go WhatsApp client using whatsmeow (message sending, receiving, contact sync)
- services/orchestrator/ - Go service managing WhatsApp worker lifecycle
- apps/api/ - Hono + Bun backend API (REST endpoints, WebSocket, auth)
- apps/web/ - React + Vite frontend (chat UI, team management)
- packages/database/ - Kysely database client & migrations

PREVIOUS FOCUS AREAS (avoid repeating recently):
$(cat "$FOCUS_HISTORY_FILE" 2>/dev/null | tail -20)

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
    "
    
    if [ ! -f "$focus_file" ]; then
        log_error "Focus file was not created: $focus_file"
        # Fallback to default
        echo "whatsapp-stability"
        return
    fi
    
    # Extract focus area
    local focus=$(grep -E "^focus:" "$focus_file" | head -1 | cut -d: -f2 | tr -d ' ')
    if [ -z "$focus" ]; then
        focus="general-improvement"
        log_warn "Could not extract focus, using default: $focus"
    fi
    
    # Record in history
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
    
    run_cmd gyolo -p "
You are analyzing a WhatsApp Web business messaging platform codebase.

FOCUS AREA: ${focus_area}

FOCUS CONTEXT (read for more details):
$(cat "$focus_file" 2>/dev/null || echo "No additional context available.")

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
    "
    
    if [ ! -f "$requirements_file" ]; then
        log_error "Requirements file was not created: $requirements_file"
        return 1
    fi
    
    # Extract slug from the requirements file
    local slug=$(grep -E "^slug:" "$requirements_file" | head -1 | cut -d: -f2 | tr -d ' ')
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
    
    run_cmd cyolo --model opus -p "
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

## Rollback Plan
<How to revert if issues arise>

IMPORTANT: Write the file now. Be thorough but practical.
    "
    
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
    
    run_cmd cyolo --model opus -p "
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
    "
    
    if [ ! -f "$tasks_file" ]; then
        log_error "Tasks file was not created: $tasks_file"
        return 1
    fi
    
    log_success "Tasks created: $tasks_file"
}

# =============================================================================
# PHASE 4: Execute Tasks (zyolo/Claude Code)
# =============================================================================
phase_execute_tasks() {
    local slug=$1
    log_step "Phase 4: Executing tasks with Claude Code..."
    
    local tasks_file="$LOOP_DIR/tasks-${slug}.md"
    local log_file="$LOOP_DIR/log-${slug}.md"
    
    # Initialize log file
    echo "# Implementation Log: ${slug}" > "$log_file"
    echo "" >> "$log_file"
    echo "Started: $(date)" >> "$log_file"
    echo "" >> "$log_file"
    
    local iteration=0
    local max_task_iterations=50  # Safety limit
    
    while [ $iteration -lt $max_task_iterations ]; do
        ((iteration++))
        log_info "Task iteration $iteration..."
        
        # Check if there are pending tasks
        local pending_count=$(grep -c "^\- \[ \]" "$tasks_file" 2>/dev/null || echo "0")
        
        if [ "$pending_count" -eq 0 ]; then
            log_success "All tasks completed!"
            break
        fi
        
        log_info "Pending tasks: $pending_count"
        
        # Execute one task
        run_cmd zyolo -p "
You are implementing improvements to a WhatsApp Web business messaging platform.

READ these files:
- ${tasks_file} (current task list)
- ${log_file} (implementation log)

YOUR TASK:
1. Find the FIRST pending task (marked with '- [ ]')
2. Implement it completely:
   - Write/modify the necessary code
   - Add appropriate tests
   - Ensure code compiles/runs
3. Update ${tasks_file}:
   - Mark the completed task as '[x]'
4. Append to ${log_file}:
   - What you did
   - Files modified
   - Any issues encountered

RULES:
- Complete ONLY ONE task per execution
- Be thorough - the task should be fully done
- If you encounter a blocker, document it and move on
- Follow existing code patterns and style

IMPORTANT: Start working now.
        "
        
        # Brief pause between tasks
        sleep 5
    done
    
    # Finalize log
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
    
    run_cmd gyolo -p "
You are a senior code reviewer evaluating implemented changes.

READ:
- ${specs_file} (original specifications)
- ${tasks_file} (completed tasks)
- ${log_file} (implementation log)
- Review the actual git diff: run 'git diff HEAD~10' or appropriate range

YOUR TASK:
1. Review all changes made during this improvement cycle
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
    "
    
    if [ ! -f "$review_file" ]; then
        log_warn "Review file was not created, assuming APPROVED"
        echo "# Code Review: ${slug}" > "$review_file"
        echo "" >> "$review_file"
        echo "## Verdict" >> "$review_file"
        echo "APPROVED" >> "$review_file"
    fi
    
    # Check verdict
    if grep -q "NEEDS_CHANGES" "$review_file"; then
        return 1  # Needs more work
    fi
    
    return 0  # Approved
}

# =============================================================================
# PHASE 6: Handle Review Feedback (zyolo)
# =============================================================================
phase_handle_review_feedback() {
    local slug=$1
    log_step "Phase 6: Addressing review feedback..."
    
    local review_file="$LOOP_DIR/review-${slug}.md"
    local log_file="$LOOP_DIR/log-${slug}.md"
    
    run_cmd zyolo -p "
You are addressing code review feedback.

READ: ${review_file}

YOUR TASK:
1. Find all unchecked items in the 'Critical (Must Fix)' section
2. Fix each issue
3. Update ${review_file} - mark fixed items as [x]
4. Append what you fixed to ${log_file}

Work through ALL critical issues before stopping.
    "
    
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
    
    # Create and switch to new branch
    log_info "Creating branch: $branch_name from $base_branch"
    run_cmd git checkout -b "$branch_name"
    
    # Stage all changes
    run_cmd git add -A
    
    # Create commit
    run_cmd cyolo --model sonnet -p "
You are creating a git commit for the improvement work.

READ:
- ${specs_file}
- ${log_file}

YOUR TASK:
1. Review what was implemented
2. Create a well-formatted commit using:

   git commit -m \"\$(cat <<'EOF'
   <type>(<scope>): <short description>

   <body - what was changed and why>

   - <bullet point of change 1>
   - <bullet point of change 2>
   EOF
   )\"

Types: feat, fix, refactor, perf, test, docs
Scope: whatsapp, api, web, orchestrator, etc.

IMPORTANT: Run the git commit command now.
    "
    
    # Push branch
    log_info "Pushing branch to remote..."
    run_cmd git push -u origin "$branch_name"
    
    # Create PR
    log_info "Creating pull request..."
    run_cmd cyolo --model sonnet -p "
You are creating a GitHub Pull Request.

READ:
- ${specs_file}
- ${log_file}

Create a PR using gh cli:

gh pr create \\
  --base \"${base_branch}\" \\
  --title \"<concise title>\" \\
  --body \"\$(cat <<'EOF'
## Summary
<1-3 bullet points of what this PR does>

## Changes
<list of key changes>

## Testing
- [ ] Unit tests added/updated
- [ ] Manual testing performed
- [ ] E2E tests (if applicable)

## Related
- Specs: .loop/specs-${slug}.md
- Log: .loop/log-${slug}.md
EOF
)\"

IMPORTANT: Run the gh pr create command now.
    "
    
    log_success "PR created for $branch_name"
    echo "$branch_name"
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
    echo ""
    
    init_loop_dir
    
    # Ensure we start from main
    log_info "Checking out main branch..."
    run_cmd git checkout main
    run_cmd git pull origin main
    
    PREVIOUS_BRANCH="main"
    
    while true; do
        # Check cycle limit
        if [ $MAX_CYCLES -ne -1 ] && [ $CURRENT_CYCLE -ge $MAX_CYCLES ]; then
            log_info "Reached max cycles ($MAX_CYCLES). Stopping."
            break
        fi
        
        local cycle_letter=$(get_cycle_letter $CURRENT_CYCLE)
        ((CURRENT_CYCLE++))
        
        echo ""
        log_info "=============================================="
        log_info "IMPROVEMENT CYCLE: $cycle_letter (${CURRENT_CYCLE})"
        log_info "=============================================="
        echo ""
        
        # Phase 0: Determine focus area (unless manually specified)
        local current_focus=""
        if [ -n "$FOCUS_AREA" ]; then
            current_focus="$FOCUS_AREA"
            log_info "Using specified focus: $current_focus"
        else
            log_agent "CYOLO" "Determining focus area..."
            current_focus=$(phase_determine_focus "$cycle_letter")
        fi
        
        # Phase 1: Identify improvements
        log_agent "GYOLO" "Identifying improvements in: $current_focus"
        local slug=$(phase_identify_improvements "$cycle_letter" "$current_focus")
        if [ -z "$slug" ]; then
            log_error "Failed to identify improvements. Stopping."
            break
        fi
        log_success "Improvement identified: $slug"
        
        # Phase 2: Create specifications
        log_agent "CYOLO" "Creating specifications..."
        phase_create_specs "$cycle_letter" "$slug"
        
        # Phase 3: Create tasks
        log_agent "CYOLO" "Breaking down into tasks..."
        phase_create_tasks "$cycle_letter" "$slug"
        
        # Phase 4: Execute tasks
        log_agent "ZYOLO" "Implementing tasks..."
        phase_execute_tasks "$slug"
        
        # Phase 5 & 6: Review loop
        local review_iterations=0
        local max_review_iterations=3
        
        while [ $review_iterations -lt $max_review_iterations ]; do
            ((review_iterations++))
            log_agent "GYOLO" "Reviewing changes (iteration $review_iterations)..."
            
            if phase_review_changes "$slug"; then
                log_success "Changes approved!"
                break
            else
                log_warn "Review requested changes..."
                log_agent "ZYOLO" "Addressing feedback..."
                phase_handle_review_feedback "$slug"
            fi
        done
        
        # Phase 7: Create branch and PR
        log_agent "CYOLO" "Creating branch and PR..."
        local new_branch=$(phase_create_pr "$slug" "$PREVIOUS_BRANCH")
        PREVIOUS_BRANCH="$new_branch"
        
        log_success "=============================================="
        log_success "CYCLE $cycle_letter COMPLETED: $slug"
        log_success "Branch: $new_branch"
        log_success "=============================================="
        
        # Cooldown before next cycle
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

# Run
main "$@"
