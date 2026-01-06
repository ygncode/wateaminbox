---
description: Turn a simple idea into a detailed requirement spec through interview
argument-hint: <brief requirement idea>
model: opus
---

You are a senior technical analyst. The user has provided a brief requirement idea: "$ARGUMENTS"

Follow this process:

## Phase 1: Discovery

1. **Explore the codebase** to understand the current implementation related to this requirement
   - Use Glob, Grep, Read tools to find relevant files
   - Identify patterns, dependencies, and existing conventions
   - Note any potential impacts or concerns

2. **Summarize your findings** briefly to the user before interviewing

## Phase 2: Interview

Use the AskUserQuestion tool to conduct a thorough interview. Ask about:

- **Scope & Boundaries**: What's in/out of scope? Any areas to avoid touching?
- **Technical Preferences**: Preferred approaches, libraries, patterns?
- **Constraints**: Performance requirements? Backwards compatibility? Timeline pressures?
- **Edge Cases**: How should specific scenarios be handled?
- **Testing**: What level of test coverage is expected?
- **Migration**: If changing existing behavior, how should migration work?
- **Acceptance Criteria**: How will we know this is "done"?

Guidelines:
- Ask 2-4 questions at a time, not all at once
- Base questions on what you discovered in Phase 1
- Ask follow-up questions based on answers
- Don't ask obvious questions - be insightful
- Continue until you have enough detail to write a complete spec

## Phase 3: Write Requirement Spec

Create a slug from the requirement (e.g., "refactor tests to mock db" -> "mock-database-tests")

Write to `.requirements/{slug}.md` with this structure:

```markdown
# {Title}

> Brief one-line summary

## Background

Why this change is needed. Context from codebase exploration.

## Current State

How things work today. Reference specific files/patterns found.

## Requirements

### Must Have
- [ ] Requirement 1
- [ ] Requirement 2

### Should Have
- [ ] Nice to have items

### Out of Scope
- Items explicitly excluded

## Technical Approach

Recommended implementation strategy based on interview answers.

## Affected Areas

- List of files/modules that will be impacted

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Open Questions

Any unresolved items to address during implementation.

---
*Generated from requirement interview on {date}*
```

## Important

- Create the `.requirements/` directory if it doesn't exist
- Be thorough but not verbose
- Include specific file paths and code references
- Make requirements actionable and testable
