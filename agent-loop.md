# Agent Loop Flow Diagram

This document describes the flow of `agent-loop.sh` - an autonomous AI-driven code workflow system.

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              AGENT LOOP                                      │
│                                                                             │
│  tasks.md ──► Detect Format ──► Classify Task ──► Route Workflow ──► Done  │
│                   │                   │                 │                   │
│              checklist/feature    feature/bug/      FULL/MEDIUM/            │
│                                   chore/refactor/   LIGHT/MINIMAL           │
│                                   docs                                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Main Entry Flow

```
                              ┌──────────────┐
                              │    START     │
                              └──────┬───────┘
                                     │
                              ┌──────▼───────┐
                              │ Parse Args   │
                              │ --dry-run    │
                              │ --resume     │
                              │ --verbose    │
                              │ --skip-merge │
                              └──────┬───────┘
                                     │
                         ┌───────────▼───────────┐
                         │   Resume Mode?        │
                         └───────────┬───────────┘
                                     │
                    ┌────────────────┴────────────────┐
                    │ YES                        NO   │
                    ▼                                 ▼
          ┌─────────────────┐               ┌─────────────────┐
          │  Load State     │               │  Detect Input   │
          │  from .loop/    │               │  Format         │
          └────────┬────────┘               └────────┬────────┘
                   │                                 │
                   │                    ┌────────────┴────────────┐
                   │                    │                         │
                   │              ┌─────▼─────┐            ┌──────▼──────┐
                   │              │ CHECKLIST │            │   FEATURE   │
                   │              │ (loop)    │            │   (single)  │
                   │              └─────┬─────┘            └──────┬──────┘
                   │                    │                         │
                   └────────────────────┼─────────────────────────┘
                                        │
                                ┌───────▼───────┐
                                │  Process Task │
                                │  (see below)  │
                                └───────────────┘
```

## Task Processing Flow

```
                              ┌──────────────────┐
                              │  Get Next Task   │
                              └────────┬─────────┘
                                       │
                              ┌────────▼─────────┐
                              │ Classify Task    │
                              │ (Sonnet AI)      │
                              └────────┬─────────┘
                                       │
           ┌───────────────────────────┼───────────────────────────┐
           │                           │                           │
     ┌─────▼─────┐              ┌──────▼──────┐            ┌───────▼───────┐
     │ feature   │              │ refactor    │            │ bug/chore/docs│
     └─────┬─────┘              └──────┬──────┘            └───────┬───────┘
           │                           │                           │
     ┌─────▼─────┐              ┌──────▼──────┐            ┌───────▼───────┐
     │   FULL    │              │   MEDIUM    │            │ LIGHT/MINIMAL │
     │ Workflow  │              │ Workflow    │            │ Workflow      │
     └─────┬─────┘              └──────┬──────┘            └───────┬───────┘
           │                           │                           │
           └───────────────────────────┼───────────────────────────┘
                                       │
                              ┌────────▼─────────┐
                              │ Generate Slug    │
                              │ (Sonnet AI)      │
                              └────────┬─────────┘
                                       │
                              ┌────────▼─────────┐
                              │ Create Worktree  │
                              │ (always)         │
                              └────────┬─────────┘
                                       │
                              ┌────────▼─────────┐
                              │ Run Workflow     │
                              └──────────────────┘
```

## Workflow Types

### FULL Workflow (Features/Refactors)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          FULL WORKFLOW                                       │
│                      (for "feature" and "refactor" type tasks)              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │   Phase 1   │───►│   Phase 2   │───►│   Phase 3   │───►│   Phase 4   │  │
│  │  Planning   │    │   Execute   │    │Code Review  │    │   Testing   │  │
│  │             │    │ (max 10)    │    │ (max 5)     │    │ (max 5)     │  │
│  └─────────────┘    └─────────────┘    └─────────────┘    └──────┬──────┘  │
│                                                                  │          │
│                                                                  ▼          │
│                                                           ┌─────────────┐   │
│                                                           │   Phase 5   │   │
│                                                           │  PR/Merge   │   │
│                                                           └─────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### LIGHT Workflow (Bugs/Chores)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          LIGHT WORKFLOW                                      │
│                   (for "bug" and "chore" type tasks)                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │ Direct Fix  │───►│Code Review  │───►│   Testing   │───►│  PR/Merge   │  │
│  │ (AI impl)   │    │ (max 5)     │    │ (max 5)     │    │             │  │
│  └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### MINIMAL Workflow (Docs)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          MINIMAL WORKFLOW                                    │
│                       (for "docs" type tasks)                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                      │
│  │ Direct Fix  │───►│   Testing   │───►│  PR/Merge   │                      │
│  │ (AI impl)   │    │ (max 5)     │    │             │                      │
│  └─────────────┘    └─────────────┘    └─────────────┘                      │
│                                                                             │
│  Note: Skips code review phase                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Phase Details

### Phase: Planning

```
┌───────────────────────────────────────────┐
│           PLANNING PHASE                  │
├───────────────────────────────────────────┤
│                                           │
│  Input:  CURRENT_TASK                     │
│  Output: .loop/{slug}/plan.md             │
│                                           │
│  AI Actions:                              │
│  1. Analyze task thoroughly               │
│  2. Research codebase                     │
│  3. Update context.md with discoveries    │
│  4. Generate implementation plan          │
│                                           │
│  Format:                                  │
│  - Overview                               │
│  - Current State                          │
│  - Requirements (Functional/Non-func)     │
│  - Implementation Steps (with status)     │
│  - Testing Strategy                       │
│  - Out of Scope                           │
│                                           │
└───────────────────────────────────────────┘
```

### Phase: Execute

```
┌───────────────────────────────────────────┐
│        EXECUTE PHASE                      │
│      (Max 10 iterations)                  │
├───────────────────────────────────────────┤
│                                           │
│  ┌────────────────────────────────┐       │
│  │ iteration = 0                  │       │
│  └───────────────┬────────────────┘       │
│                  │                        │
│      ┌───────────▼───────────┐            │
│      │ Check pending steps   │            │
│      │ (Sonnet quick check)  │            │
│      └───────────┬───────────┘            │
│                  │                        │
│       ┌──────────┴──────────┐             │
│       │ pending?            │             │
│       └──────────┬──────────┘             │
│           YES    │    NO                  │
│           │      └────────► DONE          │
│           ▼                               │
│  ┌────────────────────────────────┐       │
│  │ AI implements batch of steps   │       │
│  │ - Marks [x] when done          │       │
│  │ - Marks [!] if blocked         │       │
│  │ - Updates context.md           │       │
│  └───────────────┬────────────────┘       │
│                  │                        │
│      ┌───────────▼───────────┐            │
│      │ iteration++ < 10?     │            │
│      └───────────┬───────────┘            │
│           YES    │    NO                  │
│           │      └────────► WARN & EXIT   │
│           └──────► (loop)                 │
│                                           │
└───────────────────────────────────────────┘
```

### Phase: Code Review

```
┌───────────────────────────────────────────┐
│        CODE REVIEW PHASE                  │
│        (Max 5 iterations)                 │
├───────────────────────────────────────────┤
│                                           │
│  ┌─────────────────┐                      │
│  │ Changes exist?  │                      │
│  └────────┬────────┘                      │
│      NO   │   YES                         │
│      │    │                               │
│      │    ▼                               │
│  AUTO │  ┌─────────────┐                  │
│ APPROVE  │ git diff    │                  │
│      │   │ main        │                  │
│      │   └──────┬──────┘                  │
│      │          │                         │
│      │   ┌──────▼──────┐                  │
│      │   │ AI Review   │                  │
│      │   │ - Quality   │                  │
│      │   │ - Security  │                  │
│      │   │ - Perf      │                  │
│      │   └──────┬──────┘                  │
│      │          │                         │
│      │   ┌──────┴──────┐                  │
│      │   │  Issues?    │                  │
│      │   └──────┬──────┘                  │
│      │    YES   │   NO                    │
│      │    │     └──────► APPROVED         │
│      │    ▼                               │
│      │  ┌───────────┐                     │
│      │  │ Fix & Loop│                     │
│      │  └───────────┘                     │
│      │                                    │
│      └──────────► APPROVED                │
│                                           │
└───────────────────────────────────────────┘
```

### Phase: PR/Merge

```
┌───────────────────────────────────────────┐
│           PR/MERGE PHASE                  │
├───────────────────────────────────────────┤
│                                           │
│  ┌─────────────┐                          │
│  │  git add -A │                          │
│  └──────┬──────┘                          │
│         │                                 │
│         ▼                                 │
│  ┌─────────────┐                          │
│  │ git commit  │                          │
│  │ (conv. msg) │                          │
│  └──────┬──────┘                          │
│         │                                 │
│         ▼                                 │
│  ┌─────────────┐                          │
│  │ git push -u │                          │
│  │ origin      │                          │
│  └──────┬──────┘                          │
│         │                                 │
│         ▼                                 │
│  ┌─────────────┐                          │
│  │ gh pr create│                          │
│  └──────┬──────┘                          │
│         │                                 │
│    ┌────┴─────────┐                       │
│    │ SKIP_MERGE?  │                       │
│    └────┬─────────┘                       │
│     NO  │   YES                           │
│     │   └────────► DONE                   │
│     ▼                                     │
│  ┌─────────────────┐                      │
│  │ Wait for CI     │                      │
│  │ (up to 5 min)   │                      │
│  └────────┬────────┘                      │
│           │                               │
│           ▼                               │
│  ┌─────────────────┐                      │
│  │ gh pr merge     │                      │
│  │ --squash        │                      │
│  │ --delete-branch │                      │
│  └────────┬────────┘                      │
│           │                               │
│           ▼                               │
│  ┌─────────────────┐                      │
│  │ Cleanup worktree│                      │
│  └─────────────────┘                      │
│                                           │
└───────────────────────────────────────────┘
```

## State Management

```
┌───────────────────────────────────────────┐
│         STATE PERSISTENCE                 │
│         .loop/state.json                  │
├───────────────────────────────────────────┤
│                                           │
│  {                                        │
│    "tasks_file": "tasks.md",              │
│    "current_task": "...",                 │
│    "current_task_index": 1,               │
│    "slug": "api-rate-limiting",           │
│    "task_type": "feature",                │
│    "phase": "2",                          │
│    "phase_name": "execute",               │
│    "review_iteration": 2,                 │
│    "last_updated": "2024-..."             │
│  }                                        │
│                                           │
│  Resume with: ./agent-loop.sh --resume    │
│                                           │
└───────────────────────────────────────────┘
```

## Directory Structure

```
.loop/
├── state.json              # Resume state
├── .system-prompt.md       # Optional system prompt
└── {slug}/                 # Per-task artifacts
    ├── context.md          # Shared discoveries & decisions
    ├── plan.md             # Implementation plan
    ├── execution-log.md    # Implementation log
    ├── code-review.md      # Review results
    └── test-log.md         # Test results

.worktrees/                 # Git worktrees (always used)
└── {slug}/                 # Isolated working copy
```

## Model Selection

```
┌───────────────────────────────────────────┐
│         AI MODEL ROUTING                  │
├───────────────────────────────────────────┤
│                                           │
│  Task Classification  ──► Sonnet (always) │
│  Slug Generation      ──► Sonnet (always) │
│                                           │
│  Execution Phases:                        │
│  ┌─────────────────────────────────────┐  │
│  │ Quick Checks (Sonnet)               │  │
│  │ - Pending task check                │  │
│  │ - Review approval check             │  │
│  │ - Test status check                 │  │
│  │                                     │  │
│  │ Heavy Lifting (Opus)                │  │
│  │ - Planning                          │  │
│  │ - Execution                         │  │
│  │ - Code review                       │  │
│  │ - Testing                           │  │
│  │ - PR creation                       │  │
│  └─────────────────────────────────────┘  │
│                                           │
└───────────────────────────────────────────┘
```

## Summary Table

| Task Type | Workflow | Phases |
|-----------|----------|--------|
| feature   | FULL     | Planning → Execute → Code Review → Testing → PR/Merge |
| refactor  | MEDIUM   | Planning → Execute → Code Review → Testing → PR/Merge |
| bug       | LIGHT    | Direct Fix → Code Review → Testing → PR/Merge |
| chore     | LIGHT    | Direct Fix → Code Review → Testing → PR/Merge |
| docs      | MINIMAL  | Direct Fix → Testing → PR/Merge |
