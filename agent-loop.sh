#!/bin/bash

while true; do
    echo "Starting a new agent loop iteration..."
    claude --dangerously-skip-permissions -p "Note, the applications is already run by me. \n
    READ .specs/spec.md and .change-logs/log.md. \n
    spec.md is our end goal for the project. log.md is the changelog of what has been done so far and actively updated by you. \n
    .tasks/tasks.md contains a list of tasks that need to be done/completed for the project and it's actively updated by you. \n
    Pick ONE task from .tasks/tasks.md. Make sure to write unit/test, E2E with playwright and take screenshot and improve/verify.\n
    Commit and push changes. ONLY do one task.\n
    After you finish the task, update .tasks/tasks.md and change-log/log.md accordingly.\n"
    
    echo "Agent loop iteration completed."
    
    claude --dangerously-skip-permissions -p "check if there are any new tasks in .tasks/tasks.md that need to be done for the project.\n
    If there are no new task left, return 'true', else return 'false'.\n"
    TASKS_LEFT=$?
    if [ "$TASKS_LEFT" = "true" ]; then
        echo "No tasks left. Generating new tasks..."
        claude --dangerously-skip-permissions -p "check .specs/spec.md and our codebase. And see what we are missing and create tasks.md inside /Users/setkyar/ygncode-lab/whatsapp-web/.tasks"
        
        echo "New tasks generated. Continuing agent loop..."
    else
        sleep 2
    fi
done