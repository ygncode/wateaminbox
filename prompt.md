I want to create an agent loop. Let's call it improvement-loop.sh

gyolo --model gemini-3-pro-preview -p "" // this will create things to improve on code level/our application whatsapp mainly contact sync, profile, messages, stability etc... you help me write proper prompt. Then it will write to .loop/requirements-{slug}.md

then opus will write

cyolo --model opus -p "" // will be reading the .loop/improvement-{slug}.md and create specs-{slug}.md

then opus will read .loop/improvement-{slug}.md and specs-{slug}.md and create .loop/tasks-{slug}.md

then while loop and zyolo will use work on the tasks one by one

when it's finished gyolo will review the changes, if there are things to improve. create .loop/review-tasks-{slug}.md and zyolo work on it again.

When everything finish create a new branch improvement/{slug} and use gh command create PR by cyolo sonnet model.

Then continue the loop again. If it's start running in master branch.

then it will create improvement/a, then work on improvement/a and another improvement/b etc... so by the time when I am ready to review. I can check one by one.

gyolo is gemini yolo
cyolo is claude yolo
zyolo is zai with claude code yolo mode

some stuff that I did previously. agent-loop.sh and

#!/bin/bash

# Usage: ./agent-loop.sh [OPTIONS] <initial-plan.md>

#

# Examples:

# ./agent-loop.sh .loop/security-issues-by-opus.md

# ./agent-loop.sh --no-auto-generate plan.md

# ./agent-loop.sh --max-iterations 20 security-plan.md

#

# This script sets up a flexible agent loop using Gemini CLI.

# It initializes a .loop directory with plan.md (from the provided file),

# empty change-log.md and tasks.md.

# Then runs the agent loop: do one task at a time, update logs,

# optionally auto-generate new tasks when none left,

# and stop when the project is complete or max iterations reached.

#

# Options:

# --no-auto-generate Disable automatic new task generation when tasks are exhausted.

# --max-iterations N Stop after N iterations (default: unlimited).

# Default configuration (update if needed)

PROJECT_DIR="$(pwd)"  # Use current directory; change if you want a fixed one
LOOP_DIR="$PROJECT_DIR/.loop"
MODEL="gemini-3-flash-preview" # Updated to a more current model name; adjust as needed
GEMINI_FLAGS="--yolo" # Auto-approve tools; remove if you want manual approval
AUTO_GENERATE=true
MAX_ITERATIONS=-1 # -1 means unlimited
ITERATION_COUNT=0

# Parse options

while [["$#" -gt 0]]; do
case $1 in
--no-auto-generate)
AUTO*GENERATE=false
shift
;;
--max-iterations)
MAX_ITERATIONS="$2"
shift 2
;; -*)
echo "Unknown option: $1"
echo "Usage: $0 [OPTIONS] <initial-plan.md>"
exit 1
;;
\_)
INITIAL_PLAN="$1"
shift
;;
esac
done

if [[-z "$INITIAL_PLAN"]]; then
echo "Error: Please provide a path to the initial plan Markdown file."
echo "Example: $0 .loop/security-issues-by-opus.md"
exit 1
fi

if [[! -f "$INITIAL_PLAN"]]; then
echo "Error: File '$INITIAL_PLAN' not found."
exit 1
fi

# Setup .loop directory

mkdir -p "$LOOP_DIR"
cp "$INITIAL_PLAN" "$LOOP_DIR/plan.md"
touch "$LOOP_DIR/change-log.md"
touch "$LOOP_DIR/tasks.md"

echo "Initialized agent loop in $LOOP_DIR"
echo "Plan loaded from: $INITIAL_PLAN"
echo "Auto-generate new tasks: $AUTO_GENERATE"
echo "Max iterations: $( [[$MAX_ITERATIONS -eq -1]] && echo unlimited || echo $MAX_ITERATIONS )"
echo "Starting loop..."

cd "$PROJECT_DIR" || exit 1

while true; do
((ITERATION_COUNT++))
echo "=== Iteration $ITERATION_COUNT ==="

    if [[ $MAX_ITERATIONS -ne -1 && $ITERATION_COUNT -gt $MAX_ITERATIONS ]]; then
        echo "Max iterations ($MAX_ITERATIONS) reached. Exiting."
        break
    fi

    echo "Agent: Picking and completing ONE task..."
    gemini --model $MODEL $GEMINI_FLAGS -p "
    READ $LOOP_DIR/plan.md and $LOOP_DIR/change-log.md.
    plan.md is the overall goal/plan for this project.
    change-log.md tracks what has been done so far (actively updated by you).
    tasks.md contains the current list of pending tasks (actively updated by you).

    Pick ONE task from tasks.md (if any remain).
    Implement it fully: write code, add unit tests, E2E tests with Playwright (including screenshots where relevant), verify/fix issues.
    Use git to commit and push changes (via shell tool).
    ONLY complete one task.

    After finishing, update $LOOP_DIR/tasks.md (remove completed, reorder if needed) and append to $LOOP_DIR/change-log.md with a summary of what was done."

    echo "Iteration completed."

    # Check if tasks remain
    RESPONSE=$(gemini --model $MODEL $GEMINI_FLAGS -p "Read $LOOP_DIR/tasks.md.
    If there are any pending tasks left, output exactly 'false'.
    If no tasks remain (empty or all done), output exactly 'true'.")

    if [[ "$RESPONSE" == "true" ]]; then
        if [[ "$AUTO_GENERATE" == true ]]; then
            echo "No tasks left. Generating new tasks..."
            gemini --model $MODEL $GEMINI_FLAGS -p "Review $LOOP_DIR/plan.md, the current codebase, and $LOOP_DIR/change-log.md.
            Identify missing features, bugs, improvements, tests, or deployment steps.
            Update $LOOP_DIR/tasks.md with a new prioritized numbered list of tasks."
            echo "New tasks generated. Continuing..."
        else
            echo "No tasks left and auto-generation disabled. Stopping loop."
            break
        fi
    else
        echo "Tasks remain. Continuing to next iteration..."
        sleep 2
    fi

    # Final completion check
    FINAL_CHECK=$(gemini --model $MODEL $GEMINI_FLAGS -p "Review $LOOP_DIR/plan.md, the codebase, $LOOP_DIR/tasks.md, and $LOOP_DIR/change-log.md.
    If the project fully matches the plan (all features implemented, tested, and ready), output exactly 'done'.
    Otherwise, output 'not done'.")

    if [[ "$FINAL_CHECK" == "done" ]]; then
        echo "Project complete according to plan! Exiting loop."
        break
    fi

done

echo "Agent loop finished. Check $LOOP_DIR for plan, tasks, and change-log."
