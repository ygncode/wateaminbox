# Consolidate Mock Database Infrastructure in Tests

> Remove duplicate mock implementations across test files and standardize on centralized mocks in `apps/api/src/__tests__/mocks/`

## Background

The test suite currently has 32 test files with significant code duplication. While the infrastructure for centralized mocks exists in `apps/api/src/__tests__/mocks/`, most test files implement their own versions of the same mock utilities inline. This leads to:

- Maintenance burden when mock behavior needs to change
- Inconsistent mock behavior across tests
- ~500+ lines of duplicated code across test files
- Difficulty understanding what's being tested vs. what's mocked

## Current State

### Centralized Mocks (Already Exist)
Location: `apps/api/src/__tests__/mocks/`

- `database.mock.ts` - Contains `createMockQueryBuilder()`, `createMockDb()`, `createUpdateResult()`, `createDeleteResult()`, and entity factories
- `tenant.mock.ts` - Contains `getMockTenantConnection()`, `createMockTenantService()`, `createMockTenantContext()`
- `index.ts` - Barrel export

### Duplicate Implementations Found

**`createMockQueryBuilder()` duplicated in 15 files:**
- `services/auth.service.test.ts:34`
- `services/analytics.service.test.ts:18`
- `services/audit.service.test.ts:16`
- `services/company.service.test.ts:23`
- `services/export.service.test.ts:16`
- `services/label-sync.service.test.ts:18`
- `services/message-handler.test.ts:19`
- `services/permission.service.test.ts:16`
- `services/search.service.test.ts:17`
- `services/whatsapp.service.test.ts:18`
- `routes/contacts.route.test.ts:12`
- `routes/conversations.route.test.ts:17`
- `routes/messages.route.test.ts:12`
- `routes/notifications.route.test.ts:16`
- `routes/quick-replies.route.test.ts:18`
- (and more)

**`createMockTenantDb()` duplicated in 10 files:**
- `services/label-sync.service.test.ts:64`
- `services/whatsapp.service.test.ts:149`
- `routes/catalogs.route.test.ts:95`
- `routes/contacts.route.test.ts:71`
- `routes/conversations.route.test.ts:64`
- `routes/groups.route.test.ts` (via createMockQueryBuilder)
- `routes/messages.route.test.ts:70`
- `routes/notifications.route.test.ts:58`
- `routes/quick-replies.route.test.ts:64`
- `routes/status.route.test.ts:127`

### Performance Test (Keep As-Is)
File: `apps/api/src/__tests__/perf/contact-query-perf.test.ts`

This test intentionally uses real PostgreSQL for actual performance benchmarking. It gracefully skips via `it.skipIf(!isDatabaseAvailable)` when the database is unavailable. This should NOT be converted to mocks as it would defeat its purpose.

## Requirements

### Must Have

- [ ] Remove all inline `createMockQueryBuilder()` implementations from test files
- [ ] Remove all inline `createMockTenantDb()` implementations from test files
- [ ] Remove all inline `resetMockQueryBuilder()` implementations from test files
- [ ] Update all test files to import from `../mocks` or `../../mocks` (depending on nesting level)
- [ ] Ensure all 32 test files pass after consolidation
- [ ] Extend `createMockDb()` in `database.mock.ts` if additional methods are needed by specific tests
- [ ] Add any missing Kysely chain methods to centralized mock (e.g., `$if`, `returningAll`, custom join types)

### Should Have

- [ ] Add `createMockTenantDb()` to `tenant.mock.ts` if the pattern differs significantly from `createMockDb()`
- [ ] Standardize how tests set up mock return values (either via constructor or per-method configuration)
- [ ] Add TypeScript types for mock database interfaces
- [ ] Document mock usage patterns in a comment block at the top of `database.mock.ts`

### Out of Scope

- Converting the performance test (`perf/contact-query-perf.test.ts`) to mocks
- Adding new entity factories (only consolidate existing ones)
- Changing the overall test strategy (unit vs integration patterns)
- E2E tests in `apps/web/e2e/` (Playwright tests against real backend)

## Technical Approach

### Phase 1: Enhance Centralized Mocks

1. Review all inline implementations to identify missing methods in `createMockQueryBuilder()`
2. Add any missing Kysely methods (look for: `returningAll`, `$if`, `on`, custom joins)
3. Ensure `createMockDb()` supports table-specific return values pattern used by some tests

### Phase 2: Migrate Service Tests (11 files)

Order of migration (simplest to most complex):
1. `audit.service.test.ts` - Simple mock patterns
2. `permission.service.test.ts` - Simple mock patterns
3. `search.service.test.ts` - Simple mock patterns
4. `export.service.test.ts` - Simple mock patterns
5. `analytics.service.test.ts` - Moderate complexity
6. `company.service.test.ts` - Moderate complexity
7. `auth.service.test.ts` - Complex, many mocked modules
8. `message-handler.test.ts` - Complex, NATS mocks
9. `whatsapp.service.test.ts` - Complex, NATS + env mocks
10. `message-cleanup.service.test.ts` - Multi-tenant patterns
11. `label-sync.service.test.ts` - Custom tenant db patterns

### Phase 3: Migrate Route Tests (11 files)

1. `contacts.route.test.ts`
2. `contacts.notes.test.ts`
3. `messages.route.test.ts`
4. `conversations.route.test.ts`
5. `notifications.route.test.ts`
6. `notification-history.route.test.ts`
7. `quick-replies.route.test.ts`
8. `groups.route.test.ts`
9. `status.route.test.ts`
10. `catalogs.route.test.ts`
11. `auth.route.test.ts` (uses different pattern - rate limit mocks, verify it's fine)

### Phase 4: Migrate Integration Tests (4 files)

1. `message-cleanup.integration.test.ts`
2. `message-revoke.integration.test.ts`
3. `websocket.integration.test.ts`
4. `rate-limit.integration.test.ts`

### Migration Pattern Per File

```typescript
// BEFORE (inline mock)
function createMockQueryBuilder(returnValue: unknown = undefined) {
  const mockBuilder: Record<string, unknown> = {};
  // ... 30+ lines of implementation
}

// AFTER (import from centralized mocks)
import { createMockQueryBuilder, createMockDb, createMockUser } from "../mocks";
// or for route tests:
import { createMockQueryBuilder, createMockDb, createMockContact } from "../../mocks";
```

## Affected Areas

### Files to Modify

**Service Tests:**
- `apps/api/src/__tests__/services/auth.service.test.ts`
- `apps/api/src/__tests__/services/analytics.service.test.ts`
- `apps/api/src/__tests__/services/audit.service.test.ts`
- `apps/api/src/__tests__/services/company.service.test.ts`
- `apps/api/src/__tests__/services/contact.service.test.ts`
- `apps/api/src/__tests__/services/export.service.test.ts`
- `apps/api/src/__tests__/services/import.service.test.ts`
- `apps/api/src/__tests__/services/label-sync.service.test.ts`
- `apps/api/src/__tests__/services/message-cleanup.service.test.ts`
- `apps/api/src/__tests__/services/message-handler.test.ts`
- `apps/api/src/__tests__/services/permission.service.test.ts`
- `apps/api/src/__tests__/services/search.service.test.ts`
- `apps/api/src/__tests__/services/whatsapp.service.test.ts`

**Route Tests:**
- `apps/api/src/__tests__/routes/auth.route.test.ts`
- `apps/api/src/__tests__/routes/catalogs.route.test.ts`
- `apps/api/src/__tests__/routes/contacts.route.test.ts`
- `apps/api/src/__tests__/routes/contacts.notes.test.ts`
- `apps/api/src/__tests__/routes/conversations.route.test.ts`
- `apps/api/src/__tests__/routes/groups.route.test.ts`
- `apps/api/src/__tests__/routes/messages.route.test.ts`
- `apps/api/src/__tests__/routes/notifications.route.test.ts`
- `apps/api/src/__tests__/routes/notification-history.route.test.ts`
- `apps/api/src/__tests__/routes/quick-replies.route.test.ts`
- `apps/api/src/__tests__/routes/status.route.test.ts`

**Integration Tests:**
- `apps/api/src/__tests__/integration/message-cleanup.integration.test.ts`
- `apps/api/src/__tests__/integration/message-revoke.integration.test.ts`
- `apps/api/src/__tests__/integration/websocket.integration.test.ts`
- `apps/api/src/__tests__/integration/rate-limit.integration.test.ts`

**Mock Files (to enhance):**
- `apps/api/src/__tests__/mocks/database.mock.ts`
- `apps/api/src/__tests__/mocks/tenant.mock.ts`
- `apps/api/src/__tests__/mocks/index.ts`

**Files NOT to Modify:**
- `apps/api/src/__tests__/perf/contact-query-perf.test.ts` (keeps real PostgreSQL)
- `apps/api/src/__tests__/lib/password.test.ts` (no database mocks)
- `apps/api/src/__tests__/lib/rate-limit-store.test.ts` (no database mocks)
- `apps/api/src/__tests__/middleware/rate-limit.test.ts` (no database mocks)

## Acceptance Criteria

- [ ] All 32 test files pass: `cd apps/api && bun test`
- [ ] No inline `createMockQueryBuilder` definitions remain in test files (only in `mocks/database.mock.ts`)
- [ ] No inline `createMockTenantDb` definitions remain in test files
- [ ] All test files import mocks from `../mocks` or `../../mocks`
- [ ] Performance test still works when PostgreSQL is available
- [ ] Performance test gracefully skips when PostgreSQL is unavailable
- [ ] Code review confirms ~400-600 lines of duplicate code removed

## Open Questions

1. **Should `createMockTenantDb()` be a separate function or just use `createMockDb()` with tenant context?**
   - Some tests need table-specific behavior (e.g., tracking inserts per table)
   - Recommend: Keep `createMockDb()` generic, add helper for complex tenant scenarios

2. **Should we add a `setupTestMocks()` helper for common module mocking patterns?**
   - Pattern: `mock.module("../../services/tenant.service.js", () => createMockTenantService())`
   - Could reduce boilerplate further but may reduce test clarity

3. **Should mock return values be configurable per-call or set upfront?**
   - Current: Most tests set return values upfront via `resetMockQueryBuilder(returnValue)`
   - Alternative: Configure per-test-case with `mockDb.setQueryResult("contacts", [...])`

---
*Generated from requirement interview on 2026-01-07*
