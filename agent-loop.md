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
                              │ Classify Worktree│
                              │ Need (Sonnet AI) │
                              └────────┬─────────┘
                                       │
                         ┌─────────────┴─────────────┐
                         │                           │
                   ┌─────▼─────┐              ┌──────▼──────┐
                   │ worktree  │              │  inplace    │
                   │ (isolated)│              │ (in repo)   │
                   └─────┬─────┘              └──────┬──────┘
                         │                           │
                         │    ┌───────────────┐      │
                         └────► Create Branch │◄─────┘
                              └───────┬───────┘
                                      │
                              ┌───────▼───────┐
                              │ Run Workflow  │
                              └───────────────┘
```

## Workflow Types

### FULL Workflow (Features)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          FULL WORKFLOW                                       │
│                      (for "feature" type tasks)                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │   Phase 1   │───►│   Phase 2   │───►│   Phase 3   │───►│   Phase 4   │  │
│  │Requirements │    │Review Reqs  │    │   Specs     │    │Review Specs │  │
│  │ (generate)  │    │ (AI loop)   │    │ (generate)  │    │ (AI loop)   │  │
│  └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘  │
│                                                                     │       │
│                                                                     ▼       │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │   Phase 8   │◄───│   Phase 7   │◄───│   Phase 6   │◄───│   Phase 5   │  │
│  │  Testing    │    │Code Review  │    │  Execute    │    │  Subtasks   │  │
│  │             │    │ (AI loop)   │    │ (max 10)    │    │ (generate)  │  │
│  └──────┬──────┘    └─────────────┘    └─────────────┘    └─────────────┘  │
│         │                                                                   │
│         ▼                                                                   │
│  ┌─────────────┐                                                            │
│  │   Phase 9   │                                                            │
│  │  PR/Merge   │                                                            │
│  └─────────────┘                                                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### MEDIUM Workflow (Refactors)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          MEDIUM WORKFLOW                                     │
│                      (for "refactor" type tasks)                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │   Phase 1   │───►│   Phase 5   │───►│   Phase 6   │───►│   Phase 7   │  │
│  │Requirements │    │  Subtasks   │    │  Execute    │    │Code Review  │  │
│  │ (generate)  │    │ (generate)  │    │ (max 10)    │    │ (AI loop)   │  │
│  └─────────────┘    └─────────────┘    └─────────────┘    └──────┬──────┘  │
│                                                                  │          │
│       ┌──────────────────────────────────────────────────────────┘          │
│       ▼                                                                     │
│  ┌─────────────┐    ┌─────────────┐                                         │
│  │   Testing   │───►│  PR/Merge   │                                         │
│  └─────────────┘    └─────────────┘                                         │
│                                                                             │
│  Note: Skips requirement review and specs phases                            │
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
│  │ (AI impl)   │    │ (AI loop)   │    │             │    │             │  │
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
│  │ (AI impl)   │    │             │    │             │                      │
│  └─────────────┘    └─────────────┘    └─────────────┘                      │
│                                                                             │
│  Note: Skips code review phase                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Phase Details

### Phase: Requirements Generation

```
┌───────────────────────────────────────────┐
│         REQUIREMENTS PHASE                │
├───────────────────────────────────────────┤
│                                           │
│  Input:  CURRENT_TASK                     │
│  Output: .loop/{slug}/requirement.md      │
│                                           │
│  AI Actions:                              │
│  1. Analyze task thoroughly               │
│  2. Research codebase                     │
│  3. Update context.md with discoveries    │
│  4. Generate requirement document         │
│                                           │
│  Format:                                  │
│  - Overview                               │
│  - Current State                          │
│  - Functional Requirements                │
│  - Non-Functional Requirements            │
│  - Constraints                            │
│  - Out of Scope                           │
│  - Success Criteria                       │
│                                           │
└───────────────────────────────────────────┘
```

### Phase: Review (Requirements/Specs)

```
┌───────────────────────────────────────────┐
│           REVIEW PHASE                    │
│        (AI Self-Review Loop)              │
├───────────────────────────────────────────┤
│                                           │
│  ┌─────────────┐                          │
│  │ Read File   │                          │
│  └──────┬──────┘                          │
│         │                                 │
│         ▼                                 │
│  ┌─────────────┐                          │
│  │   Review    │                          │
│  │  Criteria:  │                          │
│  │- Scalability│                          │
│  │- Security   │                          │
│  │- Completeness                          │
│  │- Clarity    │                          │
│  └──────┬──────┘                          │
│         │                                 │
│    ┌────┴────┐                            │
│    │ Issues? │                            │
│    └────┬────┘                            │
│    YES  │  NO                             │
│    ▼    └────────►  APPROVED              │
│  ┌──────────┐                             │
│  │Fix Issues│                             │
│  └────┬─────┘                             │
│       │                                   │
│       └────────► (loop back to Review)    │
│                                           │
└───────────────────────────────────────────┘
```

### Phase: Execute Subtasks

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
│      │ Check pending tasks   │            │
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
│  │ AI implements batch of tasks   │       │
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
│  │ (if used)       │                      │
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
│    "phase": "6",                          │
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
    ├── requirement.md      # Requirements document
    ├── requirement-review.md
    ├── specs.md            # Technical specifications
    ├── specs-review.md
    ├── subtasks.md         # Breakdown of work
    ├── execution-log.md    # Implementation log
    ├── code-review.md      # Review results
    └── test-log.md         # Test results

.worktrees/                 # Git worktrees (if used)
└── {slug}/                 # Isolated working copy
```

## Model Selection

```
┌───────────────────────────────────────────┐
│         AI MODEL ROUTING                  │
├───────────────────────────────────────────┤
│                                           │
│  Task Classification  ──► Sonnet (always) │
│                                           │
│  Complexity Check:                        │
│  ┌─────────────────────────────────────┐  │
│  │ SIMPLE (Sonnet)     COMPLEX (Opus)  │  │
│  │ - Single file       - Multi-file    │  │
│  │ - Clear bug fix     - Architecture  │  │
│  │ - Config changes    - Security      │  │
│  │ - Following pattern - Optimization  │  │
│  │ - Documentation     - DB migrations │  │
│  └─────────────────────────────────────┘  │
│                                           │
│  run_cyolo() behavior:                    │
│  - force_model="auto" → AI decides        │
│  - force_model="sonnet" → use Sonnet      │
│  - force_model="opus" → use Opus          │
│                                           │
└───────────────────────────────────────────┘
```

## Summary Table

| Task Type | Workflow | Phases |
|-----------|----------|--------|
| feature   | FULL     | Requirements → Review → Specs → Review → Subtasks → Execute → Code Review → Testing → PR/Merge |
| refactor  | MEDIUM   | Requirements → Subtasks → Execute → Code Review → Testing → PR/Merge |
| bug       | LIGHT    | Direct Fix → Code Review → Testing → PR/Merge |
| chore     | LIGHT    | Direct Fix → Code Review → Testing → PR/Merge |
| docs      | MINIMAL  | Direct Fix → Testing → PR/Merge |
