# WhatsApp Web Platform - Development Changelog

A comprehensive development log for the Multi-tenant WhatsApp Web Collaborative Business Messaging Platform.

**Last Updated:** 2026-01-03

---

## Latest Updates

### 2026-01-03: Full Internationalization (i18n) Translation Coverage

Expanded translation coverage from 23 basic keys to comprehensive translations covering all UI components. Both English and Chinese (Simplified) translations now include 300+ strings across 20 namespaces.

**Translation Files Updated:**
- `apps/web/src/locales/en.json` - Complete English translations
- `apps/web/src/locales/zh-CN.json` - Complete Chinese Simplified translations

**Namespace Coverage:**
| Namespace | Description | Key Count |
|-----------|-------------|-----------|
| common | Common UI elements (save, cancel, delete, etc.) | 30 |
| auth | Authentication forms and messages | 24 |
| chat | Chat interface and messaging | 45+ |
| settings | Settings page sections | 28 |
| dashboard | Analytics and dashboard | 30 |
| labels | WhatsApp Business labels sync | 25 |
| catalogs | Product catalog management | 25 |
| quickReplies | Quick reply templates | 25 |
| contacts | Contact management | 25 |
| groups | Group chat management | 15 |
| notifications | Notification settings | 20 |
| team | Team management | 18 |
| export | Export functionality | 15 |
| search | Search features | 15 |
| status | WhatsApp status updates | 12 |
| whatsapp | WhatsApp connection status | 15 |
| audit | Audit log | 20 |
| keyboard | Keyboard shortcuts | 10 |
| errors | Error messages | 10 |
| time | Relative time formatting | 8 |

**E2E Tests Added (`e2e/tests/i18n.spec.ts`):**
- Language switcher display verification
- Default language (English) verification
- Language switching to Chinese
- Language persistence in localStorage
- Translation coverage verification for Settings page
- Edge case handling for invalid language codes

**Key Improvements:**
- All Settings page sections now fully translated
- Chat interface with message status translations
- Contact and group management translations
- Notification settings with sound choices
- Error messages with helpful context
- Time formatting with proper pluralization support ({{count}} pattern)

---

### 2026-01-03: WhatsApp Business Catalogs

Implemented comprehensive WhatsApp Business product catalog management. Users can sync catalogs from WhatsApp Business accounts, view catalog details, manage products, and archive/restore catalogs through a new Settings UI.

**Database Migration (`008_add_whatsapp_catalogs.ts`):**
- Added `catalog_status` enum: `'active' | 'archived'`
- Added `product_visibility` enum: `'visible' | 'hidden' | 'staging'`
- Created `whatsapp_catalogs` table:
  - `catalog_id` - WhatsApp's catalog identifier
  - `name`, `description` - Catalog metadata
  - `currency` - Default currency for products
  - `status` - Active or archived
  - `business_jid` - Associated WhatsApp Business account
  - `header_image_url` - Catalog banner image
  - `product_count` - Number of products
  - `last_synced_at` - Last sync timestamp
- Created `catalog_products` table:
  - `product_id`, `catalog_id` - Product identification
  - `name`, `description` - Product info
  - `price`, `currency` - Pricing
  - `image_urls` - Product images (JSON array)
  - `sku`, `category` - Product categorization
  - `availability`, `visibility` - Stock and display status
  - `url`, `retailer_id` - External references

**Backend Service (`catalog-sync.service.ts`):**
- `getWhatsAppCatalogs()` - List all synced catalogs
- `getWhatsAppCatalogByCatalogId()` - Get specific catalog
- `getCatalogProducts()` - Get products for a catalog
- `getProductByProductId()` - Get specific product
- `syncCatalogsFromWhatsApp()` - Process catalogs from Go service
- `syncCatalogProductsFromWhatsApp()` - Process products for a catalog
- `getCatalogSyncStatus()` - Get summary stats (total/active/products)
- `archiveCatalog()` / `restoreCatalog()` - Catalog lifecycle management
- `updateProductVisibility()` - Control product display status

**API Routes (`catalogs.ts`):**
- `GET /api/catalogs` - List all catalogs
- `GET /api/catalogs/status` - Get sync status summary
- `GET /api/catalogs/:catalogId` - Get specific catalog
- `GET /api/catalogs/:catalogId/products` - Get products in catalog
- `POST /api/catalogs/sync` - Trigger sync from WhatsApp (sends NATS command)
- `POST /api/catalogs/:catalogId/sync-products` - Sync products for catalog
- `POST /api/catalogs/:catalogId/archive` - Archive catalog
- `POST /api/catalogs/:catalogId/restore` - Restore archived catalog
- `PATCH /api/catalogs/:catalogId/products/:productId/visibility` - Update product visibility

**NATS Commands (`nats.ts`):**
- Added command types: `sync_catalogs`, `sync_catalog_products`
- Added `CatalogsEvent`, `CatalogProductsEvent` types for sync responses
- `publishSyncCatalogs()` - Request catalog fetch from Go service
- `publishSyncCatalogProducts()` - Request product fetch for catalog

**Frontend API (`api.ts`):**
- Added types: `WhatsAppCatalog`, `CatalogProduct`, `CatalogSyncStatus`, `ProductVisibility`
- `getWhatsAppCatalogs()`, `getCatalogSyncStatus()`, `getWhatsAppCatalog()`
- `getCatalogProducts()`, `triggerCatalogSync()`, `triggerCatalogProductsSync()`
- `archiveCatalog()`, `restoreCatalog()`, `updateProductVisibility()`

**Frontend Hooks (`useCatalogs.ts`):**
- Query keys: `catalogs.list`, `catalogs.status`, `catalogs.detail`, `catalogs.products`
- `useWhatsAppCatalogs()` - Fetch catalogs with 1-minute stale time
- `useCatalogSyncStatus()` - Fetch sync status with 30-second stale time
- `useWhatsAppCatalog(catalogId)` - Fetch single catalog
- `useCatalogProducts(catalogId)` - Fetch products for catalog
- `useTriggerCatalogSync()` - Mutation for syncing catalogs
- `useTriggerCatalogProductsSync()` - Mutation for syncing products
- `useArchiveCatalog()`, `useRestoreCatalog()` - Archive/restore mutations
- `useUpdateProductVisibility()` - Update product visibility mutation
- `useCatalogs()` - Combined hook for complete catalog management

**Frontend UI (`CatalogManager.tsx`):**
- Stats summary cards: Total Catalogs, Active, Total Products
- "Sync from WhatsApp" button with loading state
- Catalogs list with status badges (Active/Archived)
- Product count per catalog
- Archive/Restore actions per catalog
- Last sync time display with relative formatting
- Empty state with guidance for new users

**Settings Integration (`SettingsPage.tsx`):**
- Added Product Catalogs section with ShoppingBag icon (emerald theme)
- Positioned after WhatsApp Labels in left column

**Tests:**
- 16 backend unit tests in `catalogs.route.test.ts`:
  - GET /catalogs: returns empty array, returns catalogs list
  - GET /catalogs/status: returns status summary
  - GET /catalogs/:catalogId: returns 404 for missing, returns catalog
  - GET /catalogs/:catalogId/products: returns products
  - POST /catalogs/sync: triggers sync, publishes NATS command
  - POST /catalogs/:catalogId/sync-products: triggers product sync
  - POST /catalogs/:catalogId/archive: archives catalog
  - POST /catalogs/:catalogId/restore: restores catalog
  - PATCH visibility: updates product visibility
- 4 E2E test scenarios in `catalogs.spec.ts`:
  - Display empty state with sync button
  - Display list of catalogs with status badges
  - Trigger catalog sync
  - Display stats summary cards

**Files Changed:**
- `packages/database/src/migrations/008_add_whatsapp_catalogs.ts` - New migration
- `packages/database/src/client.ts` - Added CatalogStatus, ProductVisibility types
- `apps/api/src/services/catalog-sync.service.ts` - New service (~530 lines)
- `apps/api/src/routes/catalogs.ts` - New routes (~300 lines)
- `apps/api/src/routes/index.ts` - Route registration
- `apps/api/src/lib/nats.ts` - Catalog command types and publishers
- `apps/api/src/__tests__/routes/catalogs.route.test.ts` - Unit tests
- `apps/web/src/lib/api.ts` - Catalog API functions
- `apps/web/src/hooks/useCatalogs.ts` - React Query hooks
- `apps/web/src/components/settings/CatalogManager.tsx` - UI component
- `apps/web/src/components/settings/index.ts` - Export
- `apps/web/src/pages/SettingsPage.tsx` - Settings integration
- `apps/web/e2e/tests/catalogs.spec.ts` - E2E tests

---

### 2026-01-03: WhatsApp Business Labels Sync

Implemented bidirectional sync between WhatsApp Business labels and custom tags. Users can now sync labels from WhatsApp, link them to custom tags, and manage the relationship through a new Settings UI.

**Database Migration (`007_add_whatsapp_labels.ts`):**
- Added `whatsapp_labels` table to tenant schemas:
  - `label_id` - WhatsApp's label identifier
  - `name` - Label name
  - `color` - Color code (predefined or custom)
  - `predefined_id` - WhatsApp predefined color ID (0-19)
  - `synced_tag_id` - Reference to linked custom tag
  - `last_synced_at` - Last sync timestamp
- Extended `tags` table with:
  - `whatsapp_label_id` - Link to WhatsApp label
  - `synced_at` - Sync timestamp

**Backend Service (`label-sync.service.ts`):**
- `getWhatsAppLabels()` - List all synced WhatsApp labels
- `getWhatsAppLabelByLabelId()` - Get specific label by ID
- `syncLabelsFromWhatsApp()` - Process labels from Go service
- `linkTagToLabel()` - Create bidirectional link between tag and label
- `unlinkTagFromLabel()` - Remove tag-label link
- `autoCreateTagsFromLabels()` - Auto-generate tags from unlinked labels
- `getTagsWithLabelStatus()` - Get tags with their sync status
- `getLabelSyncStatus()` - Get summary of sync status
- `WHATSAPP_LABEL_COLORS` - Mapping of 20 predefined WhatsApp label colors

**API Routes (`labels.ts`):**
- `GET /api/labels` - List all WhatsApp labels
- `GET /api/labels/status` - Get sync status summary
- `GET /api/labels/:labelId` - Get specific label
- `POST /api/labels/sync` - Trigger sync from WhatsApp (sends NATS command)
- `POST /api/labels/:labelId/link` - Link tag to label
- `DELETE /api/labels/:labelId/link` - Unlink tag from label
- `POST /api/labels/auto-create` - Auto-create tags from unlinked labels
- `GET /api/labels/tags/with-status` - Get tags with label sync status
- `POST /api/labels/:labelId/apply/:contactId` - Apply label to contact in WhatsApp
- `DELETE /api/labels/:labelId/apply/:contactId` - Remove label from contact

**NATS Commands (`nats.ts`):**
- Added new command types: `sync_labels`, `apply_label`, `remove_label`
- Added `LabelsEvent` type for label sync responses
- `publishSyncLabels()` - Request label fetch from Go service
- `publishApplyLabel()` - Apply label to contact in WhatsApp
- `publishRemoveLabel()` - Remove label from contact in WhatsApp

**Frontend API (`api.ts`):**
- Added types: `WhatsAppLabel`, `LabelSyncStatus`, `TagWithLabelStatus`
- `getWhatsAppLabels()`, `getLabelSyncStatus()`, `getWhatsAppLabel()`
- `triggerLabelSync()`, `linkTagToLabel()`, `unlinkTagFromLabel()`
- `autoCreateTagsFromLabels()`, `getTagsWithLabelStatus()`
- `applyLabelToContact()`, `removeLabelFromContact()`

**Frontend Hooks (`useLabels.ts`):**
- Query keys for labels: `labels.list`, `labels.status`, `labels.tagsWithStatus`
- `useWhatsAppLabels()` - Fetch labels with 1-minute stale time
- `useLabelSyncStatus()` - Fetch sync status with 30-second stale time
- `useTagsWithLabelStatus()` - Fetch tags with sync info
- `useTriggerLabelSync()` - Mutation for syncing labels
- `useLinkTagToLabel()`, `useUnlinkTagFromLabel()` - Link management
- `useAutoCreateTagsFromLabels()` - Auto-create tags mutation
- `useApplyLabelToContact()`, `useRemoveLabelFromContact()` - Apply/remove labels
- `useLabels()` - Combined hook for complete label management

**Frontend UI (`LabelSyncManager.tsx`):**
- Stats summary cards: Total labels, Linked, Unlinked, Custom tags
- "Sync from WhatsApp" button with loading state
- "Auto-create Tags" button for bulk tag creation
- Labels list with color indicators and sync status
- Link/Unlink buttons per label with dialogs
- Link Tag dialog with tag selector dropdown
- Last sync time display with relative formatting (just now, X min ago, etc.)
- Empty state with guidance for new users

**Settings Integration (`SettingsPage.tsx`):**
- Added WhatsApp Labels section with Tag icon (indigo theme)
- Positioned after Quick Replies in left column

**Tests:**
- 13 backend unit tests in `label-sync.service.test.ts`:
  - getWhatsAppLabels: empty array, ordered by name
  - getWhatsAppLabelByLabelId: null for missing, returns when exists
  - syncLabelsFromWhatsApp: add new labels, handle updates
  - linkTagToLabel: successful linking
  - unlinkTagFromLabel: successful unlinking
  - autoCreateTagsFromLabels: create from unlinked, link existing
  - getLabelSyncStatus: correct counts, null lastSyncAt
  - WHATSAPP_LABEL_COLORS: predefined color mappings
- 5 E2E test scenarios in `label-sync.spec.ts`:
  - Display empty state with sync button
  - Display list of labels with linked/unlinked status
  - Trigger sync from WhatsApp
  - Display stats summary cards
  - Open link tag dialog

**Files Changed:**
- `packages/database/src/migrations/007_add_whatsapp_labels.ts` - New migration
- `packages/database/src/client.ts` - Added WhatsAppLabelsTable, extended TagsTable
- `apps/api/src/services/label-sync.service.ts` - New service (~350 lines)
- `apps/api/src/routes/labels.ts` - New routes (~260 lines)
- `apps/api/src/routes/index.ts` - Route registration
- `apps/api/src/lib/nats.ts` - Label command types and publishers
- `apps/api/src/__tests__/services/label-sync.service.test.ts` - Unit tests
- `apps/api/src/__tests__/mocks/database.mock.ts` - Added mock helpers
- `apps/web/src/lib/api.ts` - Label API functions
- `apps/web/src/hooks/useLabels.ts` - React Query hooks
- `apps/web/src/components/settings/LabelSyncManager.tsx` - UI component
- `apps/web/src/components/settings/index.ts` - Export
- `apps/web/src/pages/SettingsPage.tsx` - Settings integration
- `apps/web/e2e/tests/label-sync.spec.ts` - E2E tests

---

### 2026-01-03: Customer Engagement Metrics

Implemented comprehensive customer engagement metrics feature that tracks various engagement indicators based on message activity and displays them on the dashboard.

**Backend Service (`analytics.service.ts`):**
- `getEngagementMetrics()` - Calculate engagement metrics for a date range:
  - **Engagement Score (0-100)**: Weighted average of key metrics
    - Active contacts rate (25%)
    - Two-way conversation rate (25%)
    - Response rate (30%)
    - Media engagement rate (20%)
  - **Active Contacts Rate**: % of contacts with activity in period
  - **Two-Way Conversation Rate**: % of contacts with bi-directional communication
  - **Response Rate**: % of inbound messages that received a reply within 24 hours
  - **Media Engagement Rate**: % of conversations including media
  - Average messages per contact, total sent/received counts
- `getEngagementTrend()` - Daily engagement trend data:
  - Returns daily engagement scores, active contacts, message counts
  - Fills missing days with zero values
  - Calculates response rate per day

**API Routes (`analytics.ts`):**
- `GET /api/analytics/engagement` - Get engagement metrics
  - Query params: `startDate`, `endDate` (defaults to last 30 days)
  - Returns: engagement score, rates, counts, and metadata
- `GET /api/analytics/engagement/trend` - Get engagement trend over time
  - Query params: `startDate`, `endDate` (defaults to last 30 days)
  - Returns: daily engagement data points

**Frontend Hooks (`useAnalytics.ts`):**
- `useEngagementMetrics(companyId, startDate?, endDate?)` - Fetch engagement metrics
- `useEngagementTrend(companyId, startDate?, endDate?)` - Fetch engagement trend
- Added `EngagementMetrics` and `EngagementTrend` interfaces

**Dashboard UI (`Dashboard.tsx`):**
- New "Customer Engagement" section with:
  - Engagement Score circle (0-100) with gradient background
  - 4 metric cards: Active Contacts, Two-Way Chats, Response Rate, Media Engagement
  - Additional stats row: Avg messages per contact, Messages sent, Messages received
  - Engagement Trend chart (last 14 days) with color-coded bars:
    - Green (70+): High engagement
    - Yellow (40-69): Medium engagement
    - Red (<40): Low engagement
- New components: `EngagementStatCard`, `EngagementTrendChart`

**Dashboard Page Object (`dashboard.page.ts`):**
- Added locators for engagement section elements
- `engagementSection`, `engagementTitle`, `engagementScoreCircle`
- `engagementActiveContactsCard`, `engagementTwoWayCard`, `engagementResponseRateCard`, `engagementMediaCard`
- `engagementTrendChart`, `engagementAdditionalStats`

**Tests:**
- 3 backend unit tests in `analytics.service.test.ts`:
  - EngagementMetrics interface structure verification
  - EngagementTrend interface structure verification
  - Engagement score calculation formula validation
- 9 E2E tests in `dashboard.spec.ts`:
  - DashboardPage engagement locators defined
  - API response structure verification for engagement metrics
  - API response structure verification for engagement trend
  - Engagement section stat cards documentation
  - Engagement score calculation weights validation
  - Trend chart color coding documentation
  - Dashboard section inclusion verification

**Files Changed:**
- `apps/api/src/services/analytics.service.ts` - +200 lines (engagement functions)
- `apps/api/src/routes/analytics.ts` - +50 lines (engagement routes)
- `apps/web/src/hooks/useAnalytics.ts` - +60 lines (engagement hooks)
- `apps/web/src/components/dashboard/Dashboard.tsx` - +150 lines (engagement UI)
- `apps/web/e2e/pages/dashboard.page.ts` - +15 lines (engagement locators)
- `apps/web/e2e/tests/dashboard.spec.ts` - +100 lines (engagement tests)
- `apps/api/src/__tests__/services/analytics.service.test.ts` - +40 lines (engagement tests)

---

### 2026-01-03: Group Admin Actions (Tests & Toast Notifications)

Added comprehensive unit tests for group admin actions and integrated sonner toast library for action notifications.

**Backend Unit Tests (`groups.route.test.ts`):**
Added 17 new tests covering all group admin actions:
- `GET /groups/:id/admin-status` - Check if current user is admin
  - Returns admin status for connected user
  - Returns 404 for non-existent group
- `POST /groups/:id/participants/:participantJid/promote` - Promote to admin
  - Promotes participant to admin
  - Publishes NATS command on promote
  - Returns 400 if participant is already admin
- `POST /groups/:id/participants/:participantJid/demote` - Demote from admin
  - Demotes admin to regular participant
  - Publishes NATS command on demote
  - Returns 400 if participant is not admin
- `DELETE /groups/:id/participants/:participantJid` - Remove participant
  - Removes participant from group
  - Deletes participant from database
  - Publishes NATS command on remove
  - Returns 400 when trying to remove self
- `PATCH /groups/:id/settings` - Update group settings
  - Updates group name
  - Updates group description
  - Updates both name and description
  - Publishes NATS command on settings update
  - Returns 400 if no updates provided

**E2E Tests (`groups.spec.ts`):**
Added 12 tests for group admin actions:
- API response structure verification for admin status
- Group detail participant structure with admin status
- Participant JID format verification
- Feature documentation tests
- Admin action permission checks
- Self-removal prevention logic
- Response structure tests for promote/demote/remove/settings

**Toast Notifications:**
- Installed `sonner` v2.0.7 toast library
- Added `Toaster` component to `App.tsx` for global toast display
- Toast notifications show for admin action success/error states

**Files Changed:**
- `apps/api/src/__tests__/routes/groups.route.test.ts` - +909 lines (17 new tests)
- `apps/web/e2e/tests/groups.spec.ts` - +200 lines (12 new tests)
- `apps/web/package.json` - Added sonner dependency
- `apps/web/src/App.tsx` - Added Toaster component import and placement
- `bun.lock` - Updated with sonner dependency

---

### 2026-01-03: Resolution Rate Tracking

Implemented a comprehensive resolution rate tracking system that allows teams to track conversation states (open, pending, resolved) and view resolution analytics on the dashboard.

**Database Migration (`006_add_conversation_states.ts`):**
- Created `conversation_status` enum type: `'open' | 'pending' | 'resolved'`
- Created `conversation_states` table with columns:
  - `id`, `contact_id` (unique), `status`
  - `resolved_at`, `resolved_by`, `reopened_at`, `reopened_by`
  - `resolution_notes`, `created_at`, `updated_at`
- Added table to tenant schema template function
- Created indexes on `contact_id`, `status`, and `resolved_at`
- Applied to existing tenant schemas

**Backend Service (`conversation-state.service.ts`):**
- `getConversationState()` - Get current state for a contact
- `getOrCreateConversationState()` - Ensure state exists, create if not
- `resolveConversation()` - Mark conversation as resolved with optional notes
- `reopenConversation()` - Reopen a resolved conversation
- `setConversationPending()` - Set conversation to pending status
- `getResolutionStats()` - Get aggregated statistics (open/pending/resolved counts, rate)
- `getResolutionTrend()` - Get resolution trend over time period

**API Routes (in `conversations.ts`):**
- `GET /api/conversations/:id/state` - Get conversation state for a contact
- `POST /api/conversations/:id/resolve` - Mark as resolved (with optional notes)
- `POST /api/conversations/:id/reopen` - Reopen a resolved conversation
- `POST /api/conversations/:id/pending` - Set to pending status
- `GET /api/conversations/stats/resolution` - Get resolution statistics
- `GET /api/conversations/stats/resolution-trend` - Get resolution trend over time

**Frontend Hooks:**
- `useConversationState.ts`:
  - `useConversationState(contactId)` - Get conversation state
  - `useResolveConversation()` - Mutation to resolve
  - `useReopenConversation()` - Mutation to reopen
  - `useSetConversationPending()` - Mutation to set pending
- Updated `useAnalytics.ts`:
  - Added `ResolutionStats` and `ResolutionTrend` interfaces
  - Added `useResolutionStats()` hook
  - Added `useResolutionTrend()` hook

**Dashboard UI (`Dashboard.tsx`):**
- Added Resolution Rate section with 4 stat cards:
  - Open conversations (blue icon)
  - Pending conversations (yellow icon)
  - Resolved conversations (green icon)
  - Resolution rate percentage (purple icon)
- Placed after bottom row, before Response Time Analytics

**Dashboard Page Object (`dashboard.page.ts`):**
- Added locators for resolution rate section elements
- `resolutionRateSection`, `resolutionRateTitle`
- `resolutionOpenCard`, `resolutionPendingCard`, `resolutionResolvedCard`, `resolutionRateCard`

**Tests:**
- 7 backend unit tests in `conversations.route.test.ts`:
  - Get conversation state (default and existing)
  - Resolve conversation (success and 404)
  - Reopen conversation
  - Set conversation pending
  - Get resolution statistics
- 14 Chromium E2E tests in `dashboard.spec.ts`:
  - Resolution rate locators defined
  - API response structure validation
  - Section documentation tests

**Database Types (`client.ts`):**
- Added `ConversationStatus` type
- Added `ConversationStatesTable` interface
- Updated `TenantDatabase` to include `conversation_states`

---

### 2026-01-03: Feature-Based Permissions System

Implemented a granular permission system that complements the existing role-based access control. This allows fine-grained control over what team members can do within the application.

**Permissions Implemented:**
- `can_view_all_chats` - View all conversations (owner/admin only)
- `can_send_messages` - Send messages to contacts (all roles)
- `can_assign_contacts` - Assign contacts to other team members (owner/admin only)
- `can_manage_team` - Manage team members, roles, and permissions (owner only)
- `can_invite` - Invite new members to the company (owner/admin only)
- `can_export` - Export contacts, messages, and reports (owner/admin only)
- `can_delete` - Delete contacts and messages (owner/admin only)

**Role Presets:**
- **Owner**: All 7 permissions enabled
- **Admin**: 6 permissions (all except `can_manage_team`)
- **Member**: 1 permission (`can_send_messages` only)

**Backend Service (`permission.service.ts`):**
- `PERMISSIONS` constant with all permission keys
- `ROLE_PRESETS` with default permissions for each role
- `getEffectivePermissions()` - Merge role defaults with custom permissions
- `getMemberWithPermissions()` - Fetch member data with computed permissions
- `hasFeaturePermission()` - Check single permission
- `hasAllPermissions()` / `hasAnyPermission()` - Check multiple permissions
- `updateMemberPermissions()` - Owner can customize member permissions
- `resetMemberPermissions()` - Reset to role defaults
- `getPermissionDescriptions()` - Get permission metadata for UI

**Middleware Helpers (`tenant.ts`):**
- `requirePermission(permission)` - Require specific permission
- `requireAllPermissions(permissions[])` - Require all of the specified permissions
- `requireAnyPermission(permissions[])` - Require any of the specified permissions
- Updated `tenantMiddleware` to set `companyPermissions` in context

**API Routes Updated:**
- `POST /api/companies/:id/invitations` - Now uses `can_invite` permission
- `GET /api/companies/:id/invitations` - Now uses `can_invite` permission
- `DELETE /api/companies/:id/invitations/:id` - Now uses `can_invite` permission
- `POST /api/messages` - Now uses `can_send_messages` permission
- `POST /api/messages/:id/forward` - Now uses `can_send_messages` permission
- `POST /api/contacts/:id/assign` - Self-assignment allowed, assigning to others requires `can_assign_contacts`
- `DELETE /api/contacts/:id/assign` - Now uses `can_assign_contacts` permission
- All `/api/export/*` routes - Now use `can_export` permission

**New Permission Management Endpoints:**
- `GET /api/companies/:id/permissions` - List available permissions and role presets
- `GET /api/companies/:id/members/:userId/permissions` - Get member's effective permissions
- `PATCH /api/companies/:id/members/:userId/permissions` - Update member's custom permissions (owner only)
- `POST /api/companies/:id/members/:userId/permissions/reset` - Reset to role defaults (owner only)

**Frontend Hook (`usePermissions.ts`):**
- `usePermissions()` - Get role and all permission checks
- Returns: `role`, `permissions`, `hasPermission()`, `hasAnyPermission()`, `hasAllPermissions()`
- Convenience booleans: `isOwner`, `isAdmin`, `canViewAllChats`, `canSendMessages`, etc.
- `useHasPermission(permission)` - Check single permission

**Frontend Component (`PermissionGuard.tsx`):**
- Conditional rendering based on permissions
- Props: `permission`, `allOf`, `anyOf`, `requireOwner`, `requireAdmin`, `fallback`
- `withPermission()` HOC for wrapping components

**Tests:**
- 24 backend unit tests in `permission.service.test.ts`:
  - Permission constant verification
  - Role presets validation
  - Effective permissions calculation
  - Permission checking functions
  - Permission update/reset operations
- 23 E2E tests in `permissions.spec.ts`:
  - Role presets verification (owner/admin/member)
  - Permission hierarchy validation
  - Permission category verification

---

### 2026-01-03: New Contacts Trend Analytics

Added a new analytics chart showing new contacts over time with cumulative totals.

**Backend API:**
- `GET /api/analytics/contacts/trend` - Get new contacts trend over a date range
  - Query params: `startDate`, `endDate` (ISO strings, optional)
  - Returns daily new contact counts and running cumulative totals
  - Fills in missing days with zero counts
  - Excludes groups from count (individual contacts only)
  - Response: `{ data: [{ date, count, cumulativeTotal }], meta: { startDate, endDate } }`

**Backend Service:**
- Added `getNewContactsTrend()` function to `analytics.service.ts`
- Added `NewContactsTrend` interface for type safety
- Groups contacts by `DATE(created_at)` for daily counts
- Calculates cumulative totals starting from contacts before date range
- Efficiently handles date ranges with sparse data

**Frontend Components:**
- `NewContactsChart` component in `Dashboard.tsx`:
  - Purple bar chart (bg-purple-400) for days with new contacts
  - Gray bars (bg-gray-100) for days with zero new contacts
  - Summary header showing "+X new" and "Total: Y"
  - Date labels at start and end of chart
  - Tooltip on hover showing date, count, and cumulative total
- Dashboard grid updated from 2 to 3 columns for charts row
- Charts now include: Message Trend, **New Contacts**, Hourly Activity

**Frontend Hook:**
- `useNewContactsTrend(companyId, startDate?, endDate?)` - Fetch contacts trend data
- Added `NewContactsTrend` interface to `useAnalytics.ts`
- 5-minute stale time for caching

**Dashboard Page Object (E2E):**
- Added `newContactsChart`, `newContactsChartTitle`, `newContactsChartBars`, `newContactsChartSummary` locators

**Tests:**
- 7 unit tests for `getNewContactsTrend()` in `analytics.service.test.ts`:
  - Returns trend over date range
  - Calculates cumulative totals correctly
  - Fills missing days with zero counts
  - Handles empty date range
  - Handles no previous contacts
  - Excludes groups from count
  - Returns correct data structure
- 8 E2E tests in `dashboard.spec.ts`:
  - DashboardPage Object Model validation
  - Chart locators verification
  - API response structure tests
  - Component documentation tests

---

### 2026-01-03: Post Status Updates Feature

Implemented the ability to post WhatsApp status updates (text, image, video) from the web interface.

**Backend API:**
- `POST /api/status` - Post a new status update
  - Accepts `type` (text/image/video), `content` (text or caption), `mediaUrl` (for image/video)
  - Validates WhatsApp connection is active
  - Creates status record in database
  - Publishes NATS command for WhatsApp worker to post the status
  - Returns 24-hour expiration timestamp
- `DELETE /api/status/:id` - Delete own status
  - Validates ownership before deletion
  - Only allows deleting own statuses (by JID or "me")
- `GET /api/status/my` - Get user's own active statuses
  - Returns non-expired statuses posted by the connected account
  - Includes count for UI display

**NATS Integration:**
- Added `post_status` command type to NATS
- `publishPostStatus()` function publishes to company-specific subject
- `PostStatusCommand` interface for type safety

**Frontend Components:**
- `PostStatusDialog` component (`apps/web/src/components/status/PostStatusDialog.tsx`):
  - Status type selector (Text, Image, Video buttons)
  - Text input with character counter (700 max)
  - Media URL input for image/video with caption
  - Success state with confirmation message
  - Validation before submission
- Updated `StatusList` component:
  - "My status" section now clickable to open dialog
  - Shows active status count (e.g., "2 active updates")
  - Visual indicator for having active statuses
  - Plus icon button to add new status

**React Hooks:**
- `usePostStatus()` - Mutation hook for posting status
- `useDeleteStatus()` - Mutation hook for deleting status
- `useMyStatus()` - Query hook for fetching own statuses
- Added `my` key to `statusKeys` for query invalidation

**Tests:**
- Backend unit tests: 18 tests in `status.route.test.ts`:
  - GET /status returns empty list, grouped by contact, filters expired
  - GET /status/:jid returns 404 or contact statuses
  - GET /status/stats/overview returns statistics
  - GET /status/my returns empty when not connected, returns statuses when connected
  - POST /status validates type, content, mediaUrl requirements
  - POST /status returns 400 when WhatsApp not connected
  - POST /status successfully posts text/image/video statuses
  - DELETE /status/:id returns 404 or successfully deletes
- E2E tests: 7 tests in `status.spec.ts`:
  - My Status button opens dialog
  - Text type selected by default
  - Successfully post text status
  - Switch between status types
  - Validation for empty content
  - Display active status count

**Mock Data:**
- Added `MockStatusUpdate` interface to database mocks
- Added `createMockStatusUpdate()` helper function

---

### 2026-01-03: Group Message Sending Verification

Verified and documented the group messaging implementation. Sending messages to groups works via the same `/api/messages` endpoint as individual chats - the backend detects groups based on JID format (`@g.us`).

**Implementation Verified:**
- Groups are stored in `contacts` table with `is_group = true`
- Group JIDs use `@g.us` suffix (e.g., `123456789@g.us`)
- Individual contacts use `@s.whatsapp.net` suffix
- `POST /api/messages` endpoint works for both groups and individuals
- Group messages include `senderJid` field to identify message author
- `fromMe` flag distinguishes own messages from other members

**API Endpoints:**
- `GET /api/groups` - List all groups with metadata
- `GET /api/groups/:id` - Get group details with participant list
- `PATCH /api/groups/:id` - Update group custom name
- `POST /api/messages` - Send message (works for both groups and individuals)
- `GET /api/messages?contactId=X` - Get messages (works for both)

**Frontend:**
- `ChatSidebar` has "Groups" tab to filter group conversations
- `GroupList` component displays groups with participant count
- Same `MessageThread` component used for both group and individual chats
- Messages show sender info for group conversations

**Tests:**
- Backend unit tests: 16 new tests in `groups.route.test.ts`:
  - Group list retrieval with pagination
  - Group details with participant list
  - Admin status for participants
  - Group tags
  - Update group custom name
  - Send message to group using group JID
  - Publish message with group JID format
  - Group messages with different sender JIDs
  - Group JID detection (@g.us format)
- E2E tests: 5 new tests in `groups.spec.ts`:
  - Group JID format verification
  - Group messages with different senders
  - Own messages identified by fromMe flag
  - Same API format for groups and individuals
  - Documentation test for group messaging architecture

---

### 2026-01-03: Contact Reassignment/Takeover with Notification

Added instant transfer (takeover) feature that notifies the previous assignee when a contact is reassigned to another team member.

**Backend:**
- `contacts.ts` route updates:
  - `POST /api/contacts/:id/assign` now accepts optional `targetUserId` in body for reassignment
  - When reassigning from another user (takeover):
    - Creates in-app notification for the previous assignee
    - Broadcasts WebSocket event for real-time update
    - Creates audit log with detailed takeover information
  - Response includes `wasTakeover` boolean and `previousAssignee` ID
- `ws.ts` updates:
  - Added `assignment` type to ServerMessage interface for WebSocket events
- New imports in contacts.ts:
  - `getCurrentAssignment` from contact service
  - `createNotification` from notification-history service
  - `createAuditLog`, `getClientIp` from audit service
  - `broadcastToCompany` from ws routes

**Features:**
- When reassigning a contact from one user to another:
  - Previous assignee receives an "assignment" type notification with title "Contact Reassigned"
  - Notification includes link to the contact chat (`/chat/{contactId}`)
  - WebSocket broadcasts "reassigned" event to all company users
  - Audit log records full takeover details (previousAssignee, newAssignee, isTakeover flag)
- Self-assignment (claiming unassigned contact) does not trigger takeover notification
- Reassigning to the same user does not trigger takeover notification

**Tests:**
- Backend unit tests: 10 new tests in `contacts.route.test.ts`:
  - Self-assignment without notification
  - Takeover with notification creation
  - WebSocket broadcast on takeover
  - Audit log with takeover details
  - No notification when reassigning to same user
  - Phone number as display name fallback
  - 404 for non-existent contact
- E2E tests: 6 new tests in `chat.spec.ts` under "Contact Reassignment (Takeover)" section:
  - Assign button visibility in contact profile
  - Assignment status display in profile
  - Update assignment indicator after API call
  - Self-assignment flow
  - Notification center visibility
  - Takeover API response handling

---

### 2026-01-03: Keyboard Shortcuts Verification

Verified that all keyboard shortcuts specified in the spec are fully implemented.

**Implemented Shortcuts (verified in `useKeyboardShortcuts.ts` and `KeyboardShortcutsContext.tsx`):**
- `Ctrl/Cmd+N` - New chat (focuses search input)
- `Ctrl/Cmd+F` - Open global search panel
- `Escape` - Close modal/panel
- `Enter` - Send message (in `MessageComposer.tsx`)
- `Shift+Enter` - New line in message
- `Arrow Up/Down` - Navigate chat list
- `Ctrl/Cmd+/` - Show keyboard shortcuts help modal

**Features:**
- Platform-aware modifier key handling (Cmd on Mac, Ctrl on Windows/Linux)
- KeyboardShortcutsProvider context for global shortcuts
- KeyboardShortcutsModal for displaying available shortcuts
- Support for custom action registration via `useRegisterShortcutAction` hook
- Input field detection to prevent shortcut interference when typing

**Updated Tasks:**
- Marked keyboard shortcuts section as complete in `tasks.md`
- Added note about E2E test infrastructure needs for authenticated tests

---

### 2026-01-03: Full Backup ZIP Export

Added full backup export functionality that creates a ZIP file containing all contacts and messages with optional date range filtering.

**Backend:**
- `export.service.ts`: New `exportFullBackup()` function that:
  - Creates ZIP archive using fflate library
  - Includes contacts.json and contacts.csv
  - Includes messages.json and messages.csv
  - Includes backup-summary.json with export stats
  - Includes README.txt with documentation
  - Supports date range filtering (startDate, endDate)
  - Calculates message date range and totals
- `export.ts` route updates:
  - `GET /api/export/full` - Full backup as ZIP with optional date range
  - Query params: `startDate`, `endDate` (ISO date strings)
  - Returns application/zip with Content-Disposition header

**Frontend:**
- `useExport.ts`: New `useFullBackupExport()` hook for downloading backup
- `ExportDialog.tsx` updates:
  - New "full-backup" type with ZIP icon
  - Shows backup contents info (contacts, messages, summary, README)
  - Date range selector with presets (7/30/90 days, All time)
  - "Creating Backup..." loading state
- `Dashboard.tsx`: Added "Full Backup" button with Archive icon

**Dependencies:**
- Added `fflate` package for ZIP compression

**Tests:**
- Backend unit tests: 10 new tests for `exportFullBackup`:
  - ZIP file creation with all required files
  - Date filter application
  - Stats inclusion in backup
  - Empty data handling
  - README content verification
  - Date filter info in README
- E2E tests: DashboardPage POM and basic export test structure

---

### 2026-01-03: Auto-assign on First Reply

Added automatic contact assignment when a user sends their first message to an unassigned contact.

**Backend:**
- `contact.service.ts`: New service file with contact assignment functions:
  - `assignContactToUser()` - Assigns contact to a user
  - `getCurrentAssignment()` - Gets current assignment for a contact
  - `unassignContact()` - Unassigns a contact
  - `ensureContactAssignment()` - Auto-assigns if contact is unassigned (used for first reply)
- `messages.ts` route updates:
  - `POST /messages` - Now calls `ensureContactAssignment()` before sending
  - `POST /messages/:id/forward` - Also auto-assigns target contact on forward
  - Response includes `autoAssigned: boolean` flag

**Features:**
- When user sends message to unassigned contact, contact is automatically assigned to that user
- Works for both direct messages and forwarded messages
- Does not reassign if contact is already assigned to someone
- API response indicates if auto-assignment occurred

**Tests:**
- Backend unit tests: 3 new tests in `messages.route.test.ts`:
  - Auto-assign when sending to unassigned contact
  - No change when contact is already assigned
  - Response includes autoAssigned flag
- E2E tests: 4 new tests in `chat.spec.ts`:
  - Filter unassigned contacts correctly
  - Contact moves to "Assigned to me" after sending message
  - No duplicate assignment when replying to already assigned contact
  - Profile badge updates after auto-assign

---

### 2026-01-03: Quick Replies Feature

Added quick replies feature for fast message responses - predefined message templates that can be quickly inserted when messaging.

**Database:**
- New migration `005_add_quick_replies.ts` adding `quick_replies` table to tenant schemas
- Table stores: id, shortcut (unique identifier), title, content, created_by, created_at, updated_at
- Indexes on shortcut and created_by columns

**Backend:**
- `quick-replies.service.ts`: Full CRUD service with:
  - `getQuickReplies()` - List all quick replies with search and pagination
  - `getQuickReplyById()` - Get single quick reply
  - `getQuickReplyByShortcut()` - Find by shortcut for autocomplete
  - `createQuickReply()` - Create new quick reply with duplicate check
  - `updateQuickReply()` - Update existing quick reply
  - `deleteQuickReply()` - Delete quick reply
- New `quick-replies.ts` routes:
  - `GET /api/quick-replies` - List quick replies (with search, pagination)
  - `GET /api/quick-replies/:id` - Get quick reply by ID
  - `GET /api/quick-replies/search/:shortcut` - Search by shortcut
  - `POST /api/quick-replies` - Create quick reply
  - `PATCH /api/quick-replies/:id` - Update quick reply
  - `DELETE /api/quick-replies/:id` - Delete quick reply

**Frontend:**
- `QuickRepliesManager.tsx`: Full management UI component with:
  - Search bar to filter quick replies
  - Add New button to create quick replies
  - List of quick replies with shortcut badges
  - Edit and Delete actions on hover
  - Create/Edit dialog with validation
  - Delete confirmation dialog
  - Empty state display
- `useQuickReplies.ts`: React hook with TanStack Query for state management
- `api.ts`: Added Quick Replies API functions
- Integrated into Settings page with cyan Zap icon

**Validation:**
- Shortcut: 1-50 chars, alphanumeric/underscore/hyphen only
- Title: 1-255 chars
- Content: Required, no length limit
- Duplicate shortcut check on create/update

**Tests:**
- Backend unit tests: 15 tests in `quick-replies.route.test.ts` covering CRUD operations
- E2E tests: 4 tests in `quick-replies.spec.ts` for UI flows
- Added `createMockQuickReply` helper in test mocks

---

### 2026-01-03: Message Search Within Conversation

Added in-conversation message search with navigation and highlighting.

**Frontend:**
- `ConversationSearch.tsx`: New search bar component with:
  - Search input with debounced queries (300ms)
  - Results counter showing "X of Y" or "No results"
  - Previous/Next navigation buttons
  - Keyboard shortcuts (Enter, Shift+Enter, Arrow keys, Escape)
  - Loading indicator during search
  - Clear search button
- `useConversationSearch` hook: Wraps `useMessageSearch` with `contactId` filter
- `MessageThread.tsx`: Added `highlightedMessageId` prop with scroll-to-message via virtualizer
- `MessageBubble.tsx`: Added `isHighlighted` prop with yellow ring visual highlight
- `ChatPage.tsx`: Integrated search toggle state, search open/close handlers

**E2E Tests:**
- 9 new tests in `chat.spec.ts` covering:
  - Search button visibility in header
  - Search bar open/close via button and Escape key
  - "No results" display for non-matching queries
  - Result count display
  - Disabled navigation when no results
  - Clear search functionality
  - Search close on chat switch
- `chat.page.ts`: Added conversation search locators and methods

**User Experience:**
- Click search icon in message header to open search bar
- Type at least 2 characters to search
- Use Up/Down arrows or buttons to navigate results
- Matching messages scroll into view with yellow highlight ring
- Press Escape to close search

---

### 2026-01-03: In-App Notification Center

Added a complete in-app notification center with bell icon, popover panel, and backend infrastructure.

**Database:**
- New migration `004_add_notification_history.ts` adding `notification_type` enum and `notification_history` table
- Table stores: user_id, notification_type (message/mention/assignment/team/system), title, message, action_url, metadata, is_read, read_at

**Backend:**
- `notification-history.service.ts`: Full CRUD service with:
  - `createNotification()` - Create new notification
  - `getNotifications()` - List notifications with pagination and unread filter
  - `getNotificationById()` - Get single notification
  - `markNotificationAsRead()` - Mark as read
  - `markAllNotificationsAsRead()` - Mark all as read
  - `deleteNotification()` - Delete notification
  - `getUnreadCount()` - Get unread count
- Extended `notifications.ts` routes with notification history endpoints:
  - `GET /api/notifications` - List notifications (paginated)
  - `GET /api/notifications/count` - Get unread count
  - `GET /api/notifications/:id` - Get single notification
  - `POST /api/notifications` - Create notification
  - `PATCH /api/notifications/:id/read` - Mark as read
  - `POST /api/notifications/read-all` - Mark all as read
  - `DELETE /api/notifications/:id` - Delete notification

**Frontend:**
- `NotificationCenter.tsx`: Bell icon component with:
  - Unread badge counter
  - Popover panel with notification list
  - Type-specific icons (message, mention, assignment, team, system)
  - Mark as read on click
  - Delete notification
  - Mark all as read
  - Empty state display
  - Relative time formatting
- `useNotificationCenter.ts`: React hook for notification state with TanStack Query
- `popover.tsx`: New Radix UI Popover component
- Integrated into `ChatSidebar.tsx` header next to Settings

**Tests:**
- Backend unit tests: 10 tests in `notification-history.route.test.ts`
- E2E test scaffolding in `notifications.spec.ts`
- Added `createMockNotificationHistory` helper in test mocks

---

### 2026-01-03: Notification Preferences API

Added server-side persistence for notification preferences with full API support.

**Backend:**
- `notification-preferences.service.ts`: Service with `getNotificationPreferences()`, `updateNotificationPreferences()`, `muteContact()`, `unmuteContact()`
- `notifications.ts` routes: API endpoints for notification preferences
  - `GET /api/notifications/preferences` - Get user's preferences (creates defaults if none)
  - `PATCH /api/notifications/preferences` - Update preferences (partial updates)
  - `POST /api/notifications/mute` - Mute a contact
  - `POST /api/notifications/unmute` - Unmute a contact
- Database: Uses existing `notification_preferences` table in tenant schema

**Frontend:**
- Updated `useNotifications` hook to sync with API via TanStack Query
- `getNotificationPreferences`, `updateNotificationPreferences`, `muteContactApi`, `unmuteContactApi` API functions
- Hybrid approach: local localStorage for responsiveness + API sync for persistence
- Loading and syncing indicators in `NotificationSettings` component

**Tests:**
- Backend unit tests: 13 tests in `notifications.route.test.ts`
- E2E tests: `settings.spec.ts` with mock API responses
- Settings Page Object Model: `settings.page.ts`

**Features:**
- Sound enabled/disabled
- Sound choice (default, chime, bell, pop, none)
- Quiet hours (start/end times)
- Muted contacts list
- Auto-creates default preferences on first access

---

### 2026-01-02: Read Receipts Display (Message Status)

Added visual read receipts (delivery status indicators) for messages.

**Database:**
- New migration `003_add_message_status.ts` adding `message_status` enum type
- Added `status` column to messages table (`pending`, `sent`, `delivered`, `read`, `failed`)
- Updated `setup_tenant_schema()` function to include status column for new tenants

**Backend:**
- `message-handler.ts`: Receipt events now persist status to database
- `conversations.ts`: API returns `status` field with proper frontend mapping
- `messages.ts`: Send message creates with `pending` status, forward with `pending` status
- Updated `MockMessage` interface and `createMockMessage` helper in test mocks

**Frontend:**
- `MessageBubble.tsx`: Already had status icon rendering (lines 69-129)
  - Pending: gray clock circle
  - Sent: single gray checkmark
  - Delivered: double gray checkmarks
  - Read: double blue checkmarks
  - Failed: red error icon
- Status icons only shown on sent messages (not received)

**Tests:**
- Backend unit tests: 8 tests in `messages.route.test.ts` covering status in responses
- E2E tests: 5 tests in `chat.spec.ts` for Message Status (Read Receipts)

---

### 2026-01-02: Add Contact by Phone Number

Added the ability to manually create contacts by phone number.

**Backend:**
- `POST /api/contacts` endpoint for creating contacts manually
- Phone number normalization (strips +, 00 prefix, non-digits)
- Validation: 6-15 digit phone numbers
- Duplicate detection by JID or phone number (returns 409 Conflict)
- Returns created contact with JID format for WhatsApp

**Frontend:**
- `AddContactDialog` component in `apps/web/src/components/contacts/`
- `useCreateContact` hook for mutation
- Form validation with real-time feedback
- Success state with auto-navigation to new contact
- Add button in ChatList filter bar

**Tests:**
- Backend unit tests: 7 tests for contact creation (`contacts.route.test.ts`)
- E2E tests: 9 tests for Add Contact dialog flow

---

## Project Overview

Multi-tenant WhatsApp Web platform enabling businesses to manage WhatsApp communications with team collaboration, contact assignment, and audit logging.

### Tech Stack

- **Frontend**: React 18, Vite, TanStack Query, Zustand, Tailwind v4, shadcn/ui
- **Backend**: Hono, Bun, Kysely, PostgreSQL 16
- **Go Services**: Go 1.24, whatsmeow, NATS
- **Search**: Meilisearch (with PostgreSQL FTS fallback)
- **Queue**: NATS JetStream
- **Storage**: Cloudflare R2 (MinIO for dev)
- **Email**: Resend

---

## Phase 1: Foundation (Complete)

### 1.1 Project Setup

- Turborepo monorepo with `apps/web` (React+Vite), `apps/api` (Hono+Bun), `apps/marketing` (Astro)
- Go services: `services/whatsapp` and `services/orchestrator`
- Biome for TypeScript, golangci-lint for Go
- Shared packages: `@whatsapp-web/shared`, `@whatsapp-web/database`, `@whatsapp-web/ui`

### 1.2 Docker Compose

- PostgreSQL (port 5433), NATS JetStream, Meilisearch, MinIO

### 1.3 Database Schema

- Kysely with PostgreSQL, schema-per-tenant isolation
- Public schema: companies, users, company_members, invitations, user_sessions
- Tenant schema template via `setup_tenant_schema()` function

### 1.4 Authentication System

- JWT with jose library (15min access + 7d refresh tokens)
- Email+password registration with email verification (Resend)
- Password reset flow, device-based sessions
- Routes: `/auth/register`, `/auth/login`, `/auth/logout`, `/auth/verify-email`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/refresh`, `/auth/sessions`, `/auth/me`

### 1.5 Company/Tenant Setup

- Company creation on registration
- Join via invite link, company profile CRUD

---

## Phase 2: WhatsApp Core (Complete)

### 2.1 Go Orchestrator Service

- NATS JetStream client with reconnection
- Process manager for spawning/monitoring WhatsApp workers
- Graceful shutdown, process state persistence

### 2.2 WhatsApp Process Management

- Per-company WhatsApp process isolation
- Lifecycle management (start, stop, restart)
- Session state with automatic reconnection

### 2.3 NATS Integration

- JSON message schemas
- Subjects: orchestrator commands (spawn, kill, status), WhatsApp events (connected, disconnected, message)
- Message acknowledgment and retry logic

### 2.4 QR Code Connection Flow

- QR generation in WhatsApp service
- WebSocket transmission to frontend
- Session persistence after login

### 2.5 Message Send/Receive

- Incoming messages via whatsmeow stored in tenant DB
- Outgoing messages via API
- Status tracking (pending, sent, delivered, read)
- Media message support with storage upload

---

## Phase 3: Chat UI (Complete)

### 3.1 Chat List Component

- Scrollable chat list with search/filter
- Last message preview, unread count badges
- Online/offline status, pinned/muted indicators
- Loading skeletons and empty states

### 3.2 Message Thread

- Infinite scroll with auto-scroll to bottom
- Message bubbles (sent vs received) with timestamps
- Message types: text, image, video, audio, document, location, template
- Reply preview, forwarded indicator, deleted placeholder
- Right-click context menu (Reply, Forward, Star, Delete)

### 3.3 Message Composer

- Auto-resizing textarea, emoji picker button
- Attachment menu (image/video, document)
- Enter to send, Shift+Enter for new line
- Reply-to preview

### 3.4 WebSocket & State Management

- WebSocket client with auto-reconnect (exponential backoff)
- Zustand stores: `websocket-store.ts`, `chat-store.ts`
- Events: `message:new`, `message:status`, `typing:start/stop`, `presence`

### 3.5 Contact Management UI

- ContactProfile panel with editable custom name
- Shared notes (team-visible) and private notes (user-only)
- Tag management with add/remove functionality
- Assignment status with assign/unassign buttons

---

## Phase 4: Team Features (Complete)

### 4.1 Team Invitation System

- Invite by email with role selection (Admin/Member)
- 7-day expiry with resend option
- Accept via token link, cancel pending invitations
- TeamManagement UI component

### 4.2 Permission System

- Role-based access: Owner > Admin > Member
- `tenantMiddleware({ requiredRole })` enforcement
- Owner cannot be demoted or removed

### 4.3 Contact Assignment

- Assign/reassign/unassign contacts
- Assignment filter (All, Assigned to me, Unassigned)
- Assignment history with timestamps

### 4.4 Audit Logging

- `audit.service.ts` with 17 action types
- Routes: `GET /audit`, `GET /audit/actions`, `GET /audit/export`
- AuditLog UI with filters and CSV export

---

## Phase 5: Advanced Features (Complete)

### 5.1 Full-Text Search

- PostgreSQL FTS with Meilisearch upgrade path
- `search.service.ts`: messages, contacts, global search
- SearchPanel UI with tabs and filters

### 5.2 Dashboard Analytics

- `analytics.service.ts`: message stats, contact stats, team activity
- Dashboard UI: stat cards, trend charts, hourly activity
- Date range filters (7d, 30d, 90d)

### 5.3 Export Functionality

- `export.service.ts`: contacts, messages, conversations
- CSV and JSON formats
- ExportDialog UI with filters

### 5.4 Group Chat Support

- Group list with search/pagination
- GroupInfoPanel with participants and tags

### 5.5 WhatsApp Status

- Status list with ring indicators
- StatusViewer: full-screen with progress bars, keyboard navigation

---

## Phase 6: Polish (Complete)

### 6.1 Internationalization

- i18next with react-i18next
- English (en) and Simplified Chinese (zh-CN)
- LanguageSwitcher component

### 6.2 Keyboard Shortcuts

- Platform-aware (Mac Cmd, Windows Ctrl)
- `Ctrl/Cmd+N` (new chat), `Ctrl/Cmd+F` (search), `Escape` (close), `Ctrl/Cmd+/` (help)
- Arrow keys for chat navigation
- KeyboardShortcutsModal help dialog

### 6.3 Mobile Responsiveness

- Breakpoints: Mobile (<768px), Tablet (768-1024px), Desktop (>1024px)
- MobileLayout with slide navigation
- Touch targets (min 44px), safe area insets
- Swipe gestures for navigation

---

## Phase 7: Testing (In Progress)

### Playwright E2E Infrastructure

- `playwright.config.ts` with Chrome/Firefox
- Page Object Models: base, login, register, forgot-password, home, chat
- E2E tests: `auth.spec.ts` (33+ tests), `chat.spec.ts` (25+ tests)

### Backend Unit Tests

- Mock infrastructure: `database.mock.ts`, `tenant.mock.ts`
- Service tests: auth, company, audit, tenant, analytics, search, export, whatsapp
- Library tests: `password.test.ts` (30/30 passing)

**Current Stats:** 208/242 tests passing (86%)

### Known Issues

- Bun `mock.module()` path handling requires exact matches
- E2E tests require running dev server

---

## Phase 8: Remaining Features (Complete)

### 8.1 WhatsApp Connection UI

- `useWhatsAppConnection` hook with state management
- `WhatsAppConnectionPanel`: QR code display, expiry countdown, step-by-step instructions

### 8.2 Browser Notifications

- `notifications.ts` service: permission, sounds, quiet hours, muting
- `useNotifications` hook with WebSocket subscription
- `NotificationSettings` UI component

### 8.3 Dashboard Page & Navigation

- `/dashboard` route with full analytics view
- ChatSidebar with tabs (Chats, Groups, Status)
- Search integration

### 8.4 Bulk Contact Import

- `import.service.ts`: CSV parsing, phone normalization, column mapping
- Routes: template download, preview, execute import
- ContactImport UI with drag & drop

### 8.5 Response Time Analytics

- Stats: average, median, min, max response times
- SLA compliance tracking
- Team member response time comparison
- ResponseTimeAnalytics dashboard component

### 8.6 Meilisearch Integration

- `meilisearch.service.ts`: per-company indexes, typo tolerance
- Automatic fallback to PostgreSQL FTS
- `/search/status` and `/search/reindex` endpoints

### 8.7 Media Storage (Go Service)

- S3-compatible storage (`storage.go`)
- Upload media with unique key generation
- Presigned URL generation

---

## UI Integration (Complete)

### Authentication Pages

- LoginPage, RegisterPage, ForgotPasswordPage
- ProtectedRoute component with company requirement

### Main App Routes

- `/chat`, `/chat/:contactId` - Main chat interface
- `/team` - Team management
- `/audit` - Audit log
- `/settings` - User settings
- `/dashboard` - Analytics dashboard
- `/company-setup` - First company creation

### Multi-Tenant Support

- `X-Company-ID` header for all authenticated requests
- Company selection in auth context
- Redirect to company-setup when needed

### Configuration

```
# apps/web/.env
VITE_API_URL=http://localhost:3001/api
VITE_WS_URL=ws://localhost:3001/ws

# apps/api/.env
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/whatsapp_web
JWT_SECRET=dev-secret-key-change-in-production
NATS_URL=nats://localhost:4222

# Go Storage
STORAGE_ENDPOINT=http://localhost:9000
STORAGE_ACCESS_KEY=minioadmin
STORAGE_SECRET_KEY=minioadmin
STORAGE_BUCKET=whatsapp-media
```

---

## Commands

```bash
# Development
bun run dev                    # All apps
bun run build                  # Build
bun run lint && bun run format # Lint & Format

# Tests
bun run test                   # All tests
cd apps/api && bun test        # Backend unit tests
cd apps/web && bunx playwright test  # E2E tests

# Database
bun run db:migrate             # Run migrations
bun run db:generate            # Generate types

# Go Services
cd services/orchestrator && go run main.go
cd services/whatsapp && go run main.go
```
