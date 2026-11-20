# Settings and Workspace Experience Refactor Plan

## Objective

Refactor Settings, Dashboard, Team, and Audit into one cohesive, workspace-aware application experience.

The refactor must make it easy for users who belong to multiple companies—whether as owner, admin, or member—to identify their active workspace and switch between workspaces safely.

Use **Workspace** in the user interface while retaining `company` in backend and internal domain code where appropriate.

---

## Implementation Progress

### Delivered in the current refactor

- Split authenticated identity into `AuthContext` and tenant membership/selection into `WorkspaceContext`.
- Added user-scoped last-workspace persistence, URL-first workspace resolution, a chooser, and an asynchronous switch transaction with request cancellation, tenant cache removal, chat reset, push unsubscribe, rollback, and transition feedback.
- Added canonical `/w/:workspaceId/...` routes, a workspace route guard, permission-aware destination resolution, and compatibility redirects for legacy routes.
- Added a shared responsive application shell with a persistent desktop rail, mobile workspace bar and bottom navigation, effective-capability navigation, notifications, theme, account controls, and the workspace switcher.
- Added searchable workspace switching, visible membership roles, and a create-additional-workspace flow.
- Converted Settings to independently addressable, single-section routes with responsive navigation, permission-aware sections, workspace metadata, and workspace rename support.
- Updated Dashboard controls with URL-backed date ranges, responsive range controls, one export menu, and `can_export` visibility.
- Updated Team entry and actions to use effective `can_manage_team` and `can_invite` capabilities, including invite-only access, and replaced invitation `confirm()` with the shared confirmation dialog.
- Replaced Audit's unauthenticated `window.open()` export with a token-aware Blob download and aligned the API export policy with `can_export`; Audit filter state now survives in the URL.
- Added route and destination-resolution unit coverage and retained tenant query-key isolation coverage.

### Completion pass

- Dashboard now applies the selected range to compatible message-type and hourly metrics, labels all-time data, defers below-the-fold analytics until needed, and keeps responsive controls stable.
- Team now includes counts, search, role filtering, member names, desktop table/mobile cards, custom-access indicators, inviter and delivery metadata, grouped permission modes, reset-to-defaults, and Radix dialogs.
- Team server policies now enforce role hierarchy for role changes and removals, while custom-permission changes and resets are explicitly owner-only.
- Audit now returns actor metadata without requiring Team access, supports actor/action/entity/date URL filters, renders human summaries in desktop table/mobile timeline views, labels details, recursively removes sensitive detail fields, and exports every active filter through authenticated CSV downloads.
- Workspace hardening now covers active-membership refresh, removal/suspension handling, post-switch membership verification, ownership transfer, non-owner leave, and owner deletion with typed confirmation.
- Mobile navigation now provides a permission-aware More dialog for Audit, Settings, Notifications, account details, and sign out.
- The full unit test suite passes; database-backed integration scenarios remain opt-in through the existing integration-test command.

### Release follow-ups

- Run opt-in PostgreSQL integration tests and the documented multi-workspace browser scenarios in the deployment environment.
- Complete product-wide translation of legacy hardcoded strings as locale coverage expands.
- Perform a final manual screen-reader and physical-device review in addition to the implemented semantic controls, focus-managed dialogs, reduced-motion support, and responsive layouts.

---

## Executive Recommendation

Introduce a shared, workspace-aware application shell containing:

- A persistent workspace switcher
- Inbox navigation
- Permission-aware Dashboard, Team, and Audit navigation
- Settings
- Notifications, theme, and account controls

Make workspace identity part of canonical application URLs:

```text
/w/:workspaceId/chat
/w/:workspaceId/dashboard
/w/:workspaceId/team
/w/:workspaceId/audit
/w/:workspaceId/settings/:section
```

Existing routes should remain as compatibility redirects:

```text
/chat       -> /w/:activeWorkspaceId/chat
/settings   -> /w/:activeWorkspaceId/settings/general
/dashboard  -> /w/:activeWorkspaceId/dashboard
/team       -> /w/:activeWorkspaceId/team
/audit      -> /w/:activeWorkspaceId/audit
```

This prevents ambiguous deep links and makes browser history, notifications, and shared URLs workspace-safe.

---

## Baseline Implementation Review (Before Refactor)

### Existing foundation

The underlying multi-company support mostly exists:

- `GET /companies` returns all companies belonging to the authenticated user.
- Each membership includes its role and effective permissions.
- `AuthContext` exposes:
  - `companies`
  - `currentCompanyId`
  - `selectCompany()`
- API requests send `X-Company-ID`.
- Realtime and notification providers react to `currentCompanyId`.
- React Query and chat state are reset by `selectCompany()`.
- Backend routes already support company creation, updates, and deletion.
- Invitation acceptance already selects the newly joined company.

The primary missing feature is a user-facing workspace switcher and a unified workspace navigation model.

### Files reviewed

Key implementation areas reviewed include:

- `apps/web/src/App.tsx`
- `apps/web/src/contexts/auth-context.tsx`
- `apps/web/src/contexts/RealtimeProvider.tsx`
- `apps/web/src/contexts/NotificationProvider.tsx`
- `apps/web/src/components/layout/ProtectedAppLayout.tsx`
- `apps/web/src/pages/SettingsPage.tsx`
- `apps/web/src/pages/DashboardPage.tsx`
- `apps/web/src/pages/TeamPage.tsx`
- `apps/web/src/pages/AuditPage.tsx`
- `apps/web/src/components/dashboard/`
- `apps/web/src/components/team/`
- `apps/api/src/routes/companies/`
- `apps/api/src/middleware/tenant-context.ts`
- `apps/api/src/routes/analytics.ts`
- `apps/api/src/routes/audit.ts`

---

## Baseline Problems Addressed

### 1. Workspace switching exists only in application state

`selectCompany()` is implemented but is not used by any visible interface. Users with multiple memberships are silently placed in either a stored company or the first company returned by the API.

There is no visible indication of:

- The active workspace
- The user's role in that workspace
- Other available workspaces
- How to switch workspaces

### 2. Application pages do not share a coherent shell

Settings, Dashboard, Team, and Audit use separate headers, navigation behavior, spacing, and visual styles.

Examples:

- Settings has a highly styled card-based layout.
- Dashboard has both a page header and an internal Dashboard header.
- Team uses a basic standalone tab layout.
- Audit always links back to Chat and lacks complete dark-mode styling.
- Navigation depends on `location.state`, making back behavior fragile after refresh or direct navigation.
- A floating notification control is added to standalone pages and can conflict with page headers.

### 3. Settings mixes several information scopes

The current Settings page combines:

- Personal preferences
  - Language
  - Notifications
  - Keyboard shortcuts
- Workspace configuration
  - WhatsApp connections
  - Labels
  - Catalogs
  - Quick replies
- Data operations
  - Contact import
- Navigation
  - Dashboard
  - Team
  - Audit

Everything is presented in one long page and many feature components mount together, increasing cognitive load and unnecessary data fetching.

### 4. Permissions and roles are applied inconsistently

Examples:

- The Team route requires `can_manage_team`.
- Team actions then check whether the user's role is owner or admin rather than using effective permissions.
- A member granted `can_manage_team` can enter the route but cannot use management actions.
- A user granted only `can_invite` cannot access the invitation interface.
- Dashboard export actions do not consistently account for `can_export`.
- Permission route comments say that permission updates are owner-only, but enforcement currently checks `can_manage_team`.

The UI and API should use the same capability rules.

### 5. Workspace switching needs stronger isolation

The existing switch function is synchronous and performs broad cache clearing, but it does not provide a complete transition flow.

Missing safeguards include:

- Cancelling in-flight tenant requests
- Consistently company-scoped query keys
- An explicit switching state
- Route permission resolution
- Realtime transition status
- Failure recovery
- Confirmation that switching completed

### 6. Dashboard usability and data concerns

- The page displays duplicate Dashboard headings.
- Date-range controls do not consistently affect all visible metrics.
- Several metrics are effectively all-time without clear labeling.
- The page starts many analytics requests at once, which is significant against the analytics rate limit.
- Three separate export buttons create action overload.
- Controls are likely to overflow on smaller screens.

### 7. Audit usability and export concerns

- Audit records show truncated user UUIDs instead of names or emails.
- Details are rendered as raw JSON.
- The API supports more filters than the interface exposes.
- Filter state is not represented in the URL.
- CSV export uses `window.open("/api/audit/export")`.
- The export request cannot attach the access token held in memory, and Vite does not currently proxy `/api`, making the flow unreliable.

### 8. Company-management flows are incomplete

- Users cannot create a second workspace after initial onboarding.
- There is no interface for renaming a workspace despite backend support.
- There is no leave-workspace flow.
- There is no ownership-transfer flow.
- Workspace deletion is supported by the backend but not exposed through a safe owner experience.

---

## Proposed Navigation Architecture

### Desktop

Use a persistent application rail:

```text
┌──────────────────────────────────────────────────────────────┐
│ Workspace ▾ │ Contextual page header                         │
├─────────────┼────────────────────────────────────────────────┤
│ Inbox       │                                                │
│ Dashboard   │                Page content                    │
│ Team        │                                                │
│ Audit       │                                                │
│             │                                                │
│ Settings    │                                                │
│ Theme       │                                                │
│ Account     │                                                │
└─────────────┴────────────────────────────────────────────────┘
```

Navigation visibility must be based on effective permissions:

| Destination | Required capability |
|---|---|
| Inbox | Workspace membership |
| Dashboard | `can_view_dashboard` |
| Team | `can_manage_team` or `can_invite` |
| Audit | `can_view_audit` |
| Settings | Workspace membership; individual sections remain permission-aware |

### Mobile

Use:

- Workspace switcher in the top bar
- Bottom navigation for commonly used destinations
- A More sheet for lower-frequency destinations
- Permission-aware visibility
- Settings section drill-down rather than a desktop sidebar

Recommended bottom destinations:

- Inbox
- Dashboard, when permitted
- Team, when permitted
- More

The More sheet can contain:

- Audit
- Settings
- Notifications
- Theme
- Account and sign out

---

## Workspace Switcher

### Trigger

The switcher should display:

- Workspace monogram or logo
- Workspace name
- Current role
- Dropdown indicator

Example:

```text
┌─────────────────────┐
│ AC  Acme Support  ▾ │
│     Administrator   │
└─────────────────────┘
```

### Menu

The workspace menu should include:

- Search when the user has several workspaces
- Every workspace membership
- Role badges for each membership
- A checkmark on the active workspace
- Create workspace action
- Workspace settings action

Example:

```text
Switch workspace

✓ Acme Support               Owner
  Northwind Sales            Admin
  Contoso Customer Care      Member

+ Create workspace
  Workspace settings
```

### Initial workspace selection

Resolve the workspace in this order:

1. Workspace from the canonical URL, when valid
2. Last workspace selected by the current user
3. The only available workspace, when exactly one exists
4. A workspace chooser, when multiple exist without a valid preference

The last-workspace preference should be scoped by user rather than stored as one global `company_id` value.

### Switching transaction

Workspace switching should become an asynchronous operation:

1. Disable repeated switch actions.
2. Display `Switching to {workspaceName}…`.
3. Cancel in-flight requests for the old tenant.
4. Unsubscribe from old push and realtime contexts.
5. Reset tenant-specific Zustand state.
6. Update the API tenant context.
7. Update the canonical workspace URL.
8. Reconnect realtime and notification scopes.
9. Load minimum workspace bootstrap data.
10. Resolve whether the current destination is allowed.
11. Display `Switched to {workspaceName}`.

### Destination resolution

When switching workspaces:

- Dashboard may remain open if the new membership has `can_view_dashboard`.
- Team may remain open if the new membership has `can_manage_team` or `can_invite`.
- Audit may remain open if the new membership has `can_view_audit`.
- Settings should open the nearest allowed section.
- A selected conversation should reset to the new workspace Inbox.
- A forbidden destination should redirect to Inbox with a clear toast.

No data from the previous workspace should remain visible during the transition.

### Failure handling

If switching fails:

- Restore the previous workspace and route.
- Reconnect the previous realtime subscription.
- Show a non-destructive error message.
- Do not leave API state and UI state pointing to different tenants.

---

## Settings Information Architecture

Replace the current card collage with focused, route-based settings sections.

### Recommended routes

```text
/w/:workspaceId/settings/general
/w/:workspaceId/settings/connections
/w/:workspaceId/settings/quick-replies
/w/:workspaceId/settings/labels
/w/:workspaceId/settings/catalogs
/w/:workspaceId/settings/notifications
/w/:workspaceId/settings/data
/w/:workspaceId/settings/appearance
```

### Workspace

#### General

- Workspace name
- Workspace status
- Current user's role
- Workspace creation date
- Rename workspace
- Create another workspace
- Owner danger zone

#### Connections

- WhatsApp connections
- Connection health and status
- Add, reconnect, rename, and remove actions

### Inbox tools

#### Quick replies

- Search and manage templates
- Create, edit, and delete actions

#### WhatsApp labels

- Sync status
- Label-to-tag mapping
- Sync action

#### Product catalogs

- Catalog status
- Product counts
- Sync and visibility management

### Personal preferences

#### Notifications

- Desktop notification permission
- Notification enablement
- Sound
- Quiet hours
- Test notification

The page should explain that notification preferences apply to the current workspace when that is the actual persistence scope.

#### Appearance and language

- Theme
- Language
- Relevant accessibility preferences

#### Keyboard shortcuts

Keyboard shortcuts can remain a modal opened from Settings or the account menu. Avoid rendering both a global and Settings-owned modal instance.

### Data tools

- Contact import
- Export actions when `can_export` is granted
- Clear explanations of scope and consequences

### Team and Audit relationship

Team and Audit should remain top-level application destinations. Settings can provide contextual links, but should not include a generic Quick Links card duplicating primary navigation.

### Responsive behavior

- Desktop: sticky settings navigation with a focused content column
- Tablet: narrower settings navigation or collapsible section list
- Mobile: section index followed by full-screen drill-down pages
- Load only the selected section
- Preserve URL-addressable sections

---

## Dashboard Refactor

### Header

Use one contextual header containing:

- Dashboard title
- Active workspace name
- Date range
- Refresh or data-freshness indicator
- One Export dropdown

Remove the duplicate internal Dashboard title.

### Content hierarchy

Recommended order:

1. Operational overview
2. Message and contact trends
3. Response-time and SLA performance
4. Customer engagement
5. Team performance, when allowed
6. Detailed secondary metrics

### Date ranges

- Ensure the selected range affects every compatible metric.
- Clearly label all-time metrics.
- Consider custom date ranges later.
- Store range selection in URL search parameters.

### Data loading

The current page starts many analytics requests simultaneously. Improve this by:

- Creating a lightweight dashboard bootstrap or aggregate endpoint, or
- Loading below-the-fold sections when they approach the viewport
- Avoiding refetches for hidden sections
- Cancelling analytics requests during workspace switching

### Export

Replace three export buttons with one menu:

```text
Export
├── Contacts
├── Messages
└── Full backup
```

Hide or disable export actions when `can_export` is false.

### Responsive behavior

- Controls should collapse into menus on small screens.
- Charts should provide accessible summaries.
- Cards should use stable minimum widths without horizontal overflow.
- Mobile should prioritize operational metrics over decorative charts.

---

## Team Refactor

### Access model

Use capabilities rather than role names for interface behavior:

| Action | Capability or policy |
|---|---|
| Open Team destination | `can_manage_team` or `can_invite` |
| View and manage invitations | `can_invite` |
| View members | `can_manage_team`, unless a separate view permission is introduced |
| Change roles | `can_manage_team` plus server-side hierarchy policy |
| Change custom permissions | Explicit owner or management policy |
| Remove members | `can_manage_team` plus server-side hierarchy policy |

Resolve the mismatch between backend comments and actual permission enforcement before redesigning the permission UI.

### Team page

Include:

- Member count
- Pending invitation count
- Search
- Role filter
- Member and Invitation tabs
- Invite action when allowed

### Member presentation

Desktop should use a compact table. Mobile should use cards.

Show:

- Name
- Email
- Role
- Custom-access indicator
- Joined date
- Relevant actions

Update the member API to return the user's stored name instead of only email.

### Permission editor

Group permissions into:

- Chat and messaging
- Contact management
- Team management
- Workspace administration
- Data management

Provide two clear modes:

- Use role defaults
- Customize permissions

Also provide a Reset to role defaults action.

Use the shared Radix Dialog primitive instead of a custom fixed overlay so focus trapping, Escape handling, and restoration are consistent.

### Invitations

- Replace native `confirm()` with the shared confirmation dialog.
- Show delivery state, role, expiration, inviter, resend, and cancel actions.
- Provide clear success toasts.

---

## Audit Refactor

### Presentation

Use a table on desktop and an activity timeline on mobile.

Recommended desktop columns:

- Time
- Actor
- Action
- Target
- IP address
- Details

### Human-readable records

Replace raw entries such as:

```text
member.role_changed on member #e71a…
```

with summaries such as:

```text
Maya Chen changed John Doe's role from Member to Admin.
```

### Actor data

The Audit API should return actor metadata:

```ts
{
  id: string;
  name: string | null;
  email: string;
}
```

Users with audit permission should not need Team-management permission merely to resolve actor names.

### Filters

Expose filters for:

- Actor
- Action
- Entity type
- Date range

Store filter state in URL search parameters so filtered audit views survive refresh and browser navigation.

### Details

- Render known detail fields with labels.
- Keep raw JSON behind an advanced disclosure when needed.
- Avoid exposing sensitive fields without explicit review.

### Export

Replace `window.open()` with an authenticated download flow:

1. Request the CSV with the normal authenticated API client.
2. Receive a Blob.
3. Create a temporary object URL.
4. Trigger a named download.
5. Revoke the object URL.

Export controls should respect `can_export` if audit export is intended to require that capability. The backend policy and UI policy should match.

---

## Visual Design Direction

### Concept: Quiet Operations Console

Create a calm, high-confidence interface suited to teams handling customer conversations throughout the day.

### Visual characteristics

- Warm neutral application canvas
- Deep ink or forest navigation surfaces
- One restrained emerald accent
- Fine borders instead of heavy shadows
- Limited use of colored status accents
- Clear information density
- Workspace monograms as the recognizable visual motif

### Typography

Recommended pairing:

- Instrument Sans for interface text
- IBM Plex Mono for metrics, timestamps, IDs, and technical metadata

### Color direction

Example token direction:

```css
--canvas: #f5f7f4;
--surface: #ffffff;
--surface-muted: #edf1ed;
--ink: #10211b;
--ink-muted: #65736d;
--accent: #0b7a55;
--accent-soft: #dcefe7;
--danger: #b42318;
--border: #dce3de;
```

Dark mode should use the same semantic hierarchy rather than separate page-specific colors.

### Remove or reduce

- Rainbow icon-card treatments
- Duplicate page titles
- Floating controls that overlap headers
- Heavy card nesting
- Decorative elements that do not communicate state
- Different visual systems for each administrative page

---

## Technical Architecture

### Separate identity from workspace state

`AuthContext` currently owns both authentication and workspace selection. Split responsibilities:

```text
AuthContext
├── user identity
├── authentication state
├── login/logout
└── session refresh

WorkspaceContext
├── memberships
├── activeWorkspace
├── switching state
├── switchWorkspace()
├── createWorkspace()
└── capability helpers
```

### Workspace route guard

Introduce a guard that:

1. Reads `workspaceId` from the route.
2. Confirms that the user has a matching membership.
3. Activates the route workspace before tenant queries render.
4. Rejects inaccessible workspace IDs.
5. Applies destination-level permission checks.

### Query isolation

Every tenant query key should include the workspace ID.

Example:

```ts
["workspace", workspaceId, "notifications", "count"]
["workspace", workspaceId, "analytics", "dashboard"]
["workspace", workspaceId, "team", "members"]
```

Before switching:

- Cancel old-workspace requests.
- Remove or preserve old-workspace caches intentionally.
- Prevent cancelled requests from writing into active-workspace views.

Global queries such as authenticated user identity should not be cleared unnecessarily.

### API tenant context

Retain server-side membership validation. The URL identifies the intended workspace, while the API continues validating `X-Company-ID` or workspace path parameters.

Avoid allowing route state, React state, and API tenant state to disagree.

### Realtime and notifications

Workspace switching must explicitly coordinate:

- Company realtime subscription
- User-in-company realtime subscription
- Typing indicators
- Sync overlays
- Push subscriptions
- Notification query scope
- Desktop notification settings

### Capability helpers

Create reusable capability helpers rather than repeating role checks:

```ts
can("can_manage_team")
canAny(["can_manage_team", "can_invite"])
```

The server remains authoritative.

---

## Implementation Phases

Phases 1–6 and the application hardening work in Phase 7 are implemented. Deployment-environment integration runs, product-wide localization, and final manual accessibility/device review remain release activities.

### Phase 1: Workspace foundation

- Extract workspace state from `AuthContext`.
- Introduce `WorkspaceContext`.
- Convert switching into an asynchronous transaction.
- Add workspace route helpers and guard.
- Scope tenant query keys consistently.
- Add request cancellation and stale-data protection.
- Add workspace chooser and switcher.
- Add create-second-workspace flow.
- Persist the last workspace per user.

### Phase 2: Shared application shell

- Introduce desktop application rail.
- Introduce contextual page header.
- Introduce mobile top bar and bottom navigation.
- Integrate notifications, theme, account menu, and workspace switcher.
- Remove standalone page headers and floating notification fallback.
- Add workspace-aware canonical routes.
- Add legacy route redirects.
- Remove `location.state`-based back-navigation behavior.

### Phase 3: Settings information architecture

- Add nested settings routes.
- Add desktop settings navigation.
- Add mobile settings drill-down.
- Separate personal and workspace sections.
- Add workspace General settings.
- Add rename-workspace support.
- Move each existing manager into a focused section.
- Load one section at a time.
- Remove duplicate keyboard-shortcut modal ownership.

### Phase 4: Dashboard

- Consolidate page headers.
- Simplify date and export controls.
- Correct date-range semantics.
- Enforce export capability in the UI.
- Improve responsive chart behavior.
- Reduce or defer initial analytics requests.

### Phase 5: Team

- Replace role-based UI checks with effective capabilities.
- Support invite-only access.
- Return and display member names.
- Add search and filtering.
- Redesign member and invitation views.
- Redesign the permission editor.
- Align API hierarchy policies with comments and UI behavior.

### Phase 6: Audit

- Add actor metadata to API responses.
- Introduce table and mobile timeline views.
- Add full filters and URL state.
- Add human-readable event summaries.
- Replace raw JSON-first presentation.
- Implement authenticated CSV downloads.
- Complete dark-mode support.

### Phase 7: Hardening and polish

- Handle membership removal during an active session.
- Handle workspace suspension or deletion.
- Add ownership transfer and leave-workspace flows if included in scope.
- Complete localization of hardcoded interface strings.
- Run accessibility and keyboard-navigation review.
- Validate reduced-motion behavior.
- Test at mobile, tablet, laptop, and large desktop widths.

---

## Testing Strategy

### Unit tests

- Workspace selection precedence
- Capability helpers
- Route generation
- Destination resolution after switching
- Query-key workspace scoping
- Switch rollback behavior

### Integration tests

- Correct `X-Company-ID` after switching
- Old requests cancelled before tenant change
- Realtime unsubscribes from the old company
- Realtime subscribes to the new company
- Notification preferences change scope
- Chat state resets during workspace changes
- Permission-aware navigation updates immediately

### End-to-end scenarios

1. User is owner of Workspace A and member of Workspace B.
2. User switches from A Dashboard to B.
3. B does not grant Dashboard access.
4. User is redirected to B Inbox with an explanation.
5. No Workspace A analytics remain visible.

Additional scenarios:

- Admin in both workspaces
- Member with custom Dashboard permission
- Member with invite-only permission
- Direct workspace deep link
- Invalid workspace URL
- Membership removed during active use
- Accept invitation and switch to the joined workspace
- Create a second workspace
- Switch while viewing a conversation
- Switch on mobile
- Browser back and forward after switching
- Refresh on a nested Settings route

---

## Acceptance Criteria

- Users can identify the active workspace on every protected page.
- Users can switch workspace within two interactions.
- Workspace roles are visible in the switcher.
- Roles and permissions update immediately after switching.
- No old-workspace data flashes after a switch.
- Every tenant request uses the intended workspace context.
- Browser history and deep links retain workspace identity.
- Users can create a second workspace without signing out.
- Dashboard, Team, Audit, and Settings use one responsive shell.
- Team actions consistently use effective permissions.
- Dashboard and Audit exports use authenticated requests.
- Settings sections are independently addressable and loaded on demand.
- The interface works at mobile, tablet, and desktop widths.
- All dialogs support focus trapping, Escape, and focus restoration.
- Dark mode and empty, loading, error, and forbidden states are consistent.

---

## Recommended Delivery Order

Deliver the work as incremental, reviewable changes:

1. Workspace context, route model, and switch transaction
2. Workspace switcher and chooser
3. Shared application shell
4. Settings route and information-architecture refactor
5. Dashboard refactor
6. Team permission and design refactor
7. Audit refactor and authenticated export
8. Hardening, accessibility, localization, and end-to-end tests

The workspace foundation should be completed before redesigning individual pages so each page is built on the final navigation and tenant model.
