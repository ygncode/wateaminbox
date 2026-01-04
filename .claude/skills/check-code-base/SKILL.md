---
name: check-code-base
description: Check and explore the codebase using zyolo CLI. Use when you need to understand the codebase structure, find code patterns, or answer questions about the project. Must be run from project root.
---

# Check Codebase

When you need to explore or understand the codebase, use the `zyolo` CLI tool instead of manually searching.

## Query Analysis

Before running zyolo, analyze the query complexity:

**Simple Query** (1 call):
- Single focused topic
- Specific file/function/pattern lookup
- Example: "where is auth handled?"

**Complex Query** (2-5 concurrent calls):
- Multiple distinct topics connected by "and"
- Asks about different systems/components
- Broad architectural questions
- Example: "explain auth flow and database schema and API routes"

## Usage

### Simple Query (single call)
```bash
zyolo -p 'your focused question here'
```

### Complex Query (concurrent calls)

Split into focused sub-queries and run in parallel (max 5):

```bash
zyolo -p 'sub-query-1' > /tmp/zyolo_1.txt 2>&1 &
zyolo -p 'sub-query-2' > /tmp/zyolo_2.txt 2>&1 &
zyolo -p 'sub-query-3' > /tmp/zyolo_3.txt 2>&1 &
wait
cat /tmp/zyolo_1.txt /tmp/zyolo_2.txt /tmp/zyolo_3.txt
rm -f /tmp/zyolo_*.txt
```

## Examples

### Simple (1 call)
- `zyolo -p 'how is authentication handled?'`
- `zyolo -p 'where are the API routes defined?'`
- `zyolo -p 'find all React components using Zustand'`

### Complex (split into concurrent calls)

**Query**: "explain the auth flow, database schema, and frontend routing"

Split into 3 parallel calls:
```bash
zyolo -p 'explain the authentication flow' > /tmp/zyolo_1.txt 2>&1 &
zyolo -p 'explain the database schema' > /tmp/zyolo_2.txt 2>&1 &
zyolo -p 'explain the frontend routing' > /tmp/zyolo_3.txt 2>&1 &
wait
cat /tmp/zyolo_1.txt /tmp/zyolo_2.txt /tmp/zyolo_3.txt
rm -f /tmp/zyolo_*.txt
```

**Query**: "what is the full architecture of this project?"

Split into focused areas:
```bash
zyolo -p 'explain the backend API architecture' > /tmp/zyolo_1.txt 2>&1 &
zyolo -p 'explain the frontend architecture' > /tmp/zyolo_2.txt 2>&1 &
zyolo -p 'explain the Go services architecture' > /tmp/zyolo_3.txt 2>&1 &
zyolo -p 'explain the database and multi-tenancy design' > /tmp/zyolo_4.txt 2>&1 &
wait
cat /tmp/zyolo_1.txt /tmp/zyolo_2.txt /tmp/zyolo_3.txt /tmp/zyolo_4.txt
rm -f /tmp/zyolo_*.txt
```

## When to Use

- Understanding unfamiliar parts of the codebase
- Finding specific implementations or patterns
- Getting context about project architecture
- Answering questions about how features work

## Splitting Guidelines

When splitting complex queries:
1. Each sub-query should be focused on ONE topic
2. Use max 5 concurrent calls
3. Make sub-queries specific enough to get focused answers
4. Avoid overlap between sub-queries
