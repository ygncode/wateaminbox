# Missing Features & Tasks

Comparison of `.specs/spec.md` against current implementation. Last updated: 2026-01-03

---

## Phase 1: MVP (Core Flow)

### 1.1 Marketing Site (Astro) ⚠️ Partially Complete
- [x] Landing page with feature overview
- [x] Pricing page (placeholder)
- [ ] **Blog content** - section exists but empty, needs content
- [ ] **Documentation content** - section exists but needs setup guide content
- [x] Changelog section

### 1.2 Authentication ✅ Complete
- [x] Email + password registration
- [x] Email verification (via Resend)
- [x] Login with email/password
- [x] Password reset flow
- [x] Device-based sessions
- [x] View/manage active sessions
- [x] "Log out all devices" functionality

### 1.3 Company Setup ✅ Complete
- [x] Create new company on registration
- [x] Join company via invite link/code
- [x] Company profile settings

### 1.4 WhatsApp Connection ✅ Complete
- [x] QR code scanning for connection
- [x] Connection status display
- [x] Reconnection handling
- [x] Clear error states when disconnected
- [x] Ban detection with guidance

### 1.5 Contact Management ✅ Complete
- [x] Import contacts on-demand
- [x] View contact list with search
- [x] Add new contacts by phone number - `POST /api/contacts` + `AddContactDialog` component
- [x] Contact profile with WhatsApp info
- [x] Custom contact name
- [x] Shared team notes
- [x] Private personal notes

### 1.6 Messaging (1:1 Chats) ✅ Complete
- [x] Real-time message receiving
- [x] Send text messages
- [x] Send/receive media (images, videos, audio, documents)
- [x] Reply to specific messages (quoted_message_id)
- [x] Forward messages
- [x] Message reactions
- [x] Star messages
- [x] View deleted messages (marked as deleted)
- [x] **Read receipts display** - status icons (pending/sent/delivered/read) in MessageBubble
- [x] **Message search within conversation** - ConversationSearch component ✅ Completed 2026-01-03

### 1.7 Dashboard ✅ Complete
- [x] Message counts (sent, received, today, this week)
- [x] Time-range filters

---

## Phase 2: Team Collaboration

### 2.1 Team Management ⚠️ Partially Complete
- [x] Invite team members via email
- [ ] **Feature-based permissions** - only role-based (owner/admin/member) exists
  - [ ] `can_view_all_chats`
  - [ ] `can_send_messages`
  - [ ] `can_assign_contacts`
  - [ ] `can_manage_team`
  - [ ] `can_export`
  - [ ] `can_delete`
  - [ ] `can_invite`
- [ ] **Role presets customization** - Owner, Admin, Agent with customizable permissions

### 2.2 Contact Assignment ✅ Complete
- [x] Self-assign unassigned contacts
- [x] **"Assign to me" on first reply** - auto-claims contact when user sends first message ✅ Completed 2026-01-03
- [x] View assigned vs all chats filter
- [x] **Instant transfer (takeover) with notification** - reassign with alert to previous assignee ✅ Completed 2026-01-03
- [x] Assignment history in audit log

### 2.3 Notifications ✅ Complete
- [x] Browser notifications with sound (client-side)
- [x] Customizable sound choice (client-side)
- [x] Quiet hours configuration (client-side)
- [x] Mute specific contacts (client-side)
- [x] **API routes for notification preferences** - `/api/notifications/preferences` GET/PATCH ✅ Completed 2026-01-03
- [x] **Server-side notification preferences sync** - persist to database via API ✅ Completed 2026-01-03
- [x] **In-app notification center** - dropdown/panel showing recent notifications ✅ Completed 2026-01-03

### 2.4 Audit Logging ✅ Complete
- [x] Action-level logging
- [x] Audit log viewer for managers
- [x] Export audit logs

---

## Phase 3: Advanced Features

### 3.1 Group Chats ⚠️ Partially Complete
- [x] View group conversations
- [x] **Send messages to groups** - verified implementation ✅ Completed 2026-01-03
- [x] Group participant list
- [ ] **Group admin actions** - promote/demote admin, remove participant, change group settings

### 3.2 WhatsApp Status ✅ Complete
- [x] View contact status updates
- [x] **Post status updates** - API and UI for posting text/image/video status ✅ Completed 2026-01-03
- [x] Status expiration handling

### 3.3 WhatsApp Business Features ⚠️ Partially Complete
- [x] **Quick replies** - predefined message templates for fast responses ✅ Completed 2026-01-03
- [ ] **Labels sync with custom tags** - sync WhatsApp Business labels
- [ ] **Catalogs** - view/manage product catalogs (if Business account)

### 3.4 Advanced Dashboard ⚠️ Partially Complete
- [x] Response time analytics
- [x] Average reply time
- [x] SLA tracking
- [ ] **Customer engagement metrics** - track engagement scores
- [x] Active chats count
- [ ] **New contacts trend** - chart showing new contacts over time
- [ ] **Resolution rate tracking** - track conversations marked as resolved

### 3.5 Contact Organization ✅ Complete
- [x] Custom tags/labels
- [x] Bulk import contacts (CSV)
- [x] Contact fields: name, notes, tags
- [x] Filter by tags

### 3.6 Search ✅ Complete
- [x] Full-text search across all messages
- [x] Filters: date range, contact, media type
- [x] Meilisearch integration
- [x] Typo-tolerant search (via Meilisearch)

### 3.7 Export ✅ Complete
- [x] **Full backup as ZIP (messages + media)** - download entire chat history with attachments ✅ Completed 2026-01-03
- [x] Per-contact export
- [x] **Date range export** - export messages within specific date range ✅ Completed 2026-01-03

---

## Phase 4: Scale & Polish

### 4.1 Internationalization ⚠️ Partially Complete
- [x] i18n infrastructure (i18next)
- [x] English (default)
- [x] Simplified Chinese (简体中文)
- [ ] **Expand translation coverage** - only basic strings translated, need full coverage

### 4.2 Keyboard Shortcuts ✅ Complete
- [x] **All shortcuts verified implemented (2026-01-03):**
  - [x] `Ctrl/Cmd+N` - New chat (focuses search input)
  - [x] `Ctrl/Cmd+F` - Open global search panel
  - [x] `Escape` - Close modal/panel
  - [x] `Enter` - Send message
  - [x] `Shift+Enter` - New line in message
  - [x] `Arrow Up/Down` - Navigate chat list
  - [x] `Ctrl/Cmd+/` - Show keyboard shortcuts help modal
  - [x] Full keyboard navigation via KeyboardShortcutsContext

### 4.3 Mobile Responsiveness ✅ Complete
- [x] Fully responsive design
- [x] Touch-friendly interactions
- [x] Mobile-optimized chat interface

---

## API Routes Missing

### Notifications API ✅ Completed 2026-01-03
```
GET    /api/notifications/preferences   - Get user's notification preferences ✅
PATCH  /api/notifications/preferences   - Update notification preferences ✅
POST   /api/notifications/mute          - Mute a contact ✅
POST   /api/notifications/unmute        - Unmute a contact ✅
```

### Quick Replies API ✅ Completed 2026-01-03
```
GET    /api/quick-replies               - List quick reply templates ✅
GET    /api/quick-replies/:id           - Get quick reply by ID ✅
GET    /api/quick-replies/search/:shortcut - Search by shortcut ✅
POST   /api/quick-replies               - Create quick reply template ✅
PATCH  /api/quick-replies/:id           - Update quick reply ✅
DELETE /api/quick-replies/:id           - Delete quick reply ✅
```

### Export API ✅ Completed 2026-01-03
```
GET    /api/export/full                 - Full backup export as ZIP ✅
GET    /api/export/contacts             - Export contacts (CSV/JSON) ✅
GET    /api/export/messages             - Export messages with date range filter ✅
```

### Status API ✅ Completed 2026-01-03
```
POST   /api/status                      - Post a new WhatsApp status update ✅
DELETE /api/status/:id                  - Delete posted status ✅
GET    /api/status/my                   - Get user's own active statuses ✅
```

### Additional Missing Endpoints
```
POST   /api/contacts/manual             - Create contact by phone number
```

---

## Database Schema Missing

### Tables Added
```sql
-- ✅ COMPLETED: Quick replies for fast responses (migration 005_add_quick_replies.ts)
quick_replies (
  id UUID PRIMARY KEY,
  shortcut VARCHAR(50),
  title VARCHAR(255),
  content TEXT,
  created_by UUID,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)
```

### Tables to Add
```sql
-- Conversation resolution tracking
conversation_states (
  id UUID PRIMARY KEY,
  contact_id UUID REFERENCES contacts,
  status ENUM('open', 'resolved', 'pending'),
  resolved_by UUID,
  resolved_at TIMESTAMP,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)
```

### Columns to Add
```sql
-- Add to company_members table
ALTER TABLE company_members ADD COLUMN permissions JSONB;

-- ✅ COMPLETED: messages.status column added via migration 003_add_message_status.ts
-- Uses message_status enum: 'pending', 'sent', 'delivered', 'read', 'failed'
```

---

## Testing Tasks

### Backend Unit Tests
- [x] Notification preferences service tests ✅ Completed 2026-01-03
- [x] Quick replies route tests ✅ Completed 2026-01-03
- [x] Auto-assign on first reply tests ✅ Completed 2026-01-03
- [x] Export service tests (ZIP generation) ✅ Completed 2026-01-03
- [x] Contact reassignment/takeover notification tests ✅ Completed 2026-01-03
- [ ] Permission checking middleware tests

### E2E Tests
- [ ] Contact creation by phone number flow *(requires E2E auth fixture improvements - mocking infrastructure needed)*
- [x] Quick replies management flow ✅ Completed 2026-01-03
- [x] Auto-assign on first reply flow ✅ Completed 2026-01-03
- [x] Export functionality tests ✅ Completed 2026-01-03
- [x] Notification settings flow ✅ Completed 2026-01-03
- [x] Contact reassignment/takeover flow ✅ Completed 2026-01-03
- [x] Group message sending ✅ Completed 2026-01-03
- [x] Status posting flow ✅ Completed 2026-01-03

**Note:** E2E tests requiring authenticated state need proper API mocking setup. The current `authenticatedPage` fixture uses mock tokens that don't work with real API. Full API interception is needed for reliable E2E testing.

---

## Priority Ranking

### High Priority (Core Functionality Gaps)
1. Feature-based permissions system
2. ~~"Assign to me" on first reply~~ ✅ Completed 2026-01-03
3. ~~Add contacts by phone number~~ ✅ Completed 2026-01-02
4. ~~Read receipts display~~ ✅ Completed 2026-01-02
5. ~~Notification preferences API~~ ✅ Completed 2026-01-03
6. ~~In-app notification center~~ ✅ Completed 2026-01-03
7. ~~Message search within conversation~~ ✅ Completed 2026-01-03

### Medium Priority (Enhanced Experience)
8. ~~Quick replies~~ ✅ Completed 2026-01-03
9. ~~Full backup as ZIP export~~ ✅ Completed 2026-01-03
10. ~~Instant transfer/takeover notifications~~ ✅ Completed 2026-01-03

### Low Priority (Nice to Have)
11. WhatsApp Business features (labels sync, catalogs)
12. ~~Post status updates~~ ✅ Completed 2026-01-03
13. Group admin actions
14. Resolution rate tracking
15. Blog/docs content

---

## Summary

| Phase | Total Features | Completed | Partial | Missing |
|-------|---------------|-----------|---------|---------|
| Phase 1 | 28 | 26 | 2 | 0 |
| Phase 2 | 16 | 8 | 5 | 3 |
| Phase 3 | 18 | 13 | 2 | 3 |
| Phase 4 | 10 | 5 | 4 | 1 |
| **Total** | **72** | **52** | **13** | **7** |

**Overall Completion: ~73% fully complete, ~18% partial, ~9% missing**

*Last updated: 2026-01-03 - Post status updates feature complete*
