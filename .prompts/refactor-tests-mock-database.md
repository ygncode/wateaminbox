# Task: Refactor Tests to Use Mock/In-Memory Database

## Objective

Refactor all API tests to use mocks for unit tests and SQLite in-memory database for integration tests, eliminating dependency on a running PostgreSQL database.

## Type

Refactor

## Scope

- **Primary directory**: `apps/api/src/__tests__/`
  - Unit tests in `services/`
  - Integration tests in `integration/`
  - Test helpers in `helpers/`
- **Related files to analyze**:
  - `packages/database/` - Kysely client and types
  - Current test setup files and fixtures

## Requirements

### Acceptance Criteria

- [ ] All tests pass without requiring a running PostgreSQL database
- [ ] Unit tests use mocks at the service/repository level
- [ ] Integration tests use SQLite in-memory database where real SQL is needed
- [ ] Existing test assertions and coverage are maintained
- [ ] No breaking changes to test behavior

### Constraints

- Must maintain existing test coverage and assertions
- Keep using Bun's test runner and `mock.module()` pattern
- Preserve Kysely type safety where possible

### Implementation Approach

1. **For Unit Tests**: Mock database calls at the service level using Bun's `mock.module()`
2. **For Integration Tests**: Use SQLite in-memory database for tests that need real SQL execution

## Verification

1. Stop any running PostgreSQL database
2. Run `cd apps/api && bun test` - all tests must pass
3. Run `bun run test` from root - all tests must pass

## Additional Context

### Pre-Implementation Steps

1. **Analyze current test setup**: Thoroughly review existing tests to understand:
   - How database is currently used in tests
   - Existing mock patterns (if any)
   - Test fixtures and setup/teardown patterns

2. **Research**: If necessary, use web search to research:
   - Bun test mocking best practices
   - SQLite in-memory with Kysely
   - Testing patterns for multi-tenant schemas

### Technical Notes

- Per CLAUDE.md: Mock paths must be relative to test file (e.g., `../../services/tenant.service.js`)
- The app uses schema-per-tenant isolation (`tenant_{company_id}`)
- Current database client is in `packages/database`

### Expected Deliverables

1. Refactored test files with proper mocking
2. Test helper utilities for common mock patterns
3. SQLite adapter setup for integration tests (if needed)
4. Updated test setup/teardown logic
