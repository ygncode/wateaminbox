# Fix and Slim Down E2E Test Suite

> Fix 74+ failing E2E tests by updating page objects and removing obsolete/redundant tests

## Background

The E2E test suite has accumulated 74 failing tests out of ~290 total. The failures stem from UI refactoring that broke test selectors, while the tests themselves were not updated. Many tests reference UI elements that no longer exist (e.g., "Menu" button in chat list header), and some test files cover niche features that add maintenance burden without proportional value.

## Current State

### Test Suite Structure
Located in `apps/web/e2e/`:
- **20 spec files** with ~290 tests total
- **Page Object Model** in `e2e/pages/` (8 page classes)
- **Auth fixtures** in `e2e/fixtures/` with API mocking
- **Playwright config** with Chromium browser, 30s timeout

### Key Page Objects with Broken Selectors (chat.page.ts)
```typescript
// BROKEN - These selectors don't match current UI:
this.chatListHeader = page.getByRole("tab", { name: "Chats" }); // Tab exists but hidden text on mobile
this.menuButton = page.getByRole("button", { name: "Menu" });   // REMOVED - no longer in chat sidebar
this.logoutButton = page.getByRole("button", { name: /log out/i }); // Now in Settings page
```

### Current UI Reality (ChatSidebar.tsx, ChatList.tsx)
- **Tabs**: `TabButton` with `role="tab"` + `aria-selected`, label "Chats"/"Groups" (text hidden on small screens)
- **No Menu button** in sidebar - logout moved to Settings page (`/settings`)
- **Settings link** in sidebar navigation next to NotificationCenter
- **Assignment filters**: "All", "Unread", "Assigned to me", "Unassigned" (no labels)
- **Add contact button** with `data-testid="add-contact-button"`

### Failure Categories
1. **Locator timeouts** (most common): `chatListHeader`, `menuButton` not found
2. **Obsolete feature tests**: Testing UI elements that were removed/relocated
3. **Complex test sections**: Conversation Search, Auto-assign, Contact Reassignment fail in beforeEach
4. **Mocking issues**: Some API responses don't match current backend format

## Requirements

### Must Have

- [ ] **Update chat.page.ts selectors** to match current UI structure
  - Fix `chatListHeader` selector (role="tab" with accessible name)
  - Remove `menuButton` and `logoutButton` locators (UI removed)
  - Add `settingsLink` locator for navigation to settings
  - Update filter button selectors to match current filter names

- [ ] **Remove "Logout Flow" tests from auth.spec.ts** (lines 295-346)
  - Tests: `should display menu button`, `should open menu dropdown`, `should logout and redirect`, `should clear authentication state`
  - Reason: Menu button no longer exists in chat sidebar

- [ ] **Remove obsolete test files** for niche features:
  - `catalogs.spec.ts` (4 tests) - Product catalog feature
  - `export.spec.ts` (3 tests) - Data export feature
  - `label-sync.spec.ts` (5 tests) - Label synchronization
  - `visual-regression.spec.ts` (17 tests) - Screenshot comparisons (maintenance burden)

- [ ] **Fix remaining core test files** to pass:
  - `auth.spec.ts` - Update remaining tests after logout removal
  - `chat.spec.ts` - Fix beforeEach hooks using broken selectors
  - `chat-ux.spec.ts` - Update to match current UX
  - `notifications.spec.ts` - Verify selector compatibility
  - `quick-replies.spec.ts` - Verify selector compatibility
  - `settings.spec.ts` - Verify selector compatibility
  - `dark-mode.spec.ts` - Verify selector compatibility

### Should Have

- [ ] **Clean up settings.page.ts** to add logout test capability via Settings page
- [ ] **Remove redundant conversation search tests** (lines 973-1138 in chat.spec.ts) if they duplicate other tests
- [ ] **Consolidate auto-assign tests** (lines 1177-1273 in chat.spec.ts) - complex mocking, high failure rate
- [ ] **Remove i18n.spec.ts** (12 tests) - internationalization testing can be done differently

### Out of Scope

- Adding new tests for missing coverage
- Changing React component code (no data-testid additions)
- Backend API changes
- Playwright configuration changes (timeouts, parallelization)
- accessibility.spec.ts changes (keep for compliance)
- groups.spec.ts changes (core feature)
- permissions.spec.ts changes (core feature)
- whatsapp-connection.spec.ts changes (core feature)
- dashboard.spec.ts changes (core feature)
- add-contact.spec.ts changes (already uses data-testid)
- message-revoke.spec.ts changes (core feature)
- status.spec.ts changes (core feature)

## Technical Approach

### Phase 1: Remove Obsolete Tests (~29 tests)
1. Delete obsolete spec files: `catalogs.spec.ts`, `export.spec.ts`, `label-sync.spec.ts`, `visual-regression.spec.ts`
2. Remove "Logout Flow" describe block from `auth.spec.ts`
3. Remove `i18n.spec.ts`

### Phase 2: Update Page Objects
1. **chat.page.ts** - Primary focus:
   ```typescript
   // Update to match actual UI
   this.chatListHeader = page.getByRole("navigation", { name: "Chat list" });
   this.chatsTab = page.getByRole("tab", { name: /chats/i });
   this.settingsLink = page.getByRole("link", { name: "Settings" });
   // Remove: menuButton, logoutButton, userInfoSection
   ```

2. **settings.page.ts** - Add logout locator:
   ```typescript
   this.logoutButton = page.getByRole("button", { name: /sign out/i });
   ```

### Phase 3: Fix Remaining Test Files
1. Update tests that called `chatPage.logout()` or `chatPage.openMenu()`
2. Update tests using removed locators
3. Run tests file-by-file to identify remaining issues
4. Fix any API mock mismatches

### Phase 4: Verify and Clean Up
1. Run full test suite
2. Remove any remaining flaky tests
3. Update playwright report

## Affected Areas

### Files to Delete
- `apps/web/e2e/tests/catalogs.spec.ts`
- `apps/web/e2e/tests/export.spec.ts`
- `apps/web/e2e/tests/label-sync.spec.ts`
- `apps/web/e2e/tests/visual-regression.spec.ts`
- `apps/web/e2e/tests/i18n.spec.ts`
- `apps/web/e2e/tests/visual-regression.spec.ts-snapshots/` (directory)

### Files to Modify
- `apps/web/e2e/pages/chat.page.ts` - Update selectors
- `apps/web/e2e/pages/settings.page.ts` - Add logout capability
- `apps/web/e2e/tests/auth.spec.ts` - Remove logout flow tests
- `apps/web/e2e/tests/chat.spec.ts` - Fix broken selectors usage
- `apps/web/e2e/tests/chat-ux.spec.ts` - Fix broken selectors usage

### Files to Keep Unchanged (verify passing)
- `apps/web/e2e/tests/accessibility.spec.ts`
- `apps/web/e2e/tests/add-contact.spec.ts`
- `apps/web/e2e/tests/dark-mode.spec.ts`
- `apps/web/e2e/tests/dashboard.spec.ts`
- `apps/web/e2e/tests/groups.spec.ts`
- `apps/web/e2e/tests/message-revoke.spec.ts`
- `apps/web/e2e/tests/notifications.spec.ts`
- `apps/web/e2e/tests/permissions.spec.ts`
- `apps/web/e2e/tests/quick-replies.spec.ts`
- `apps/web/e2e/tests/settings.spec.ts`
- `apps/web/e2e/tests/status.spec.ts`
- `apps/web/e2e/tests/whatsapp-connection.spec.ts`

## Acceptance Criteria

- [ ] Test suite runs with 0 failures
- [ ] Test count reduced from ~290 to ~240 tests (removing ~50 tests)
- [ ] All core features covered: auth, chat, messages, settings, notifications, groups
- [ ] No test file references non-existent UI elements
- [ ] `bunx playwright test` completes in under 3 minutes
- [ ] Page objects accurately reflect current UI structure

## Open Questions

1. Should we keep any visual regression tests for critical UI components?
2. Are there any i18n-specific tests that should be preserved in other files?
3. Should logout tests be re-added via the Settings page flow?

---
*Generated from requirement interview on 2026-01-07*
