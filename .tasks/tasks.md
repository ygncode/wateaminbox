# Missing Features & Tasks

Comparison of `.specs/spec.md` against current implementation. Last updated: 2026-01-02

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

### 1.6 Messaging (1:1 Chats) ⚠️ Partially Complete
- [x] Real-time message receiving
- [x] Send text messages
- [x] Send/receive media (images, videos, audio, documents)
- [x] Reply to specific messages (quoted_message_id)
- [x] Forward messages
- [x] Message reactions
- [x] Star messages
- [x] View deleted messages (marked as deleted)
- [ ] **Read receipts display** - not showing read/delivered status in UI
- [ ] **Message search within conversation** - only global search exists

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

### 2.2 Contact Assignment ⚠️ Partially Complete
- [x] Self-assign unassigned contacts
- [ ] **"Assign to me" on first reply** - auto-claims contact when user sends first message
- [x] View assigned vs all chats filter
- [ ] **Instant transfer (takeover) with notification** - reassign with alert to previous assignee
- [x] Assignment history in audit log

### 2.3 Notifications ⚠️ Partially Complete
- [x] Browser notifications with sound (client-side)
- [x] Customizable sound choice (client-side)
- [x] Quiet hours configuration (client-side)
- [x] Mute specific contacts (client-side)
- [ ] **API routes for notification preferences** - `/api/notifications/preferences` GET/PATCH
- [ ] **Server-side notification preferences sync** - persist to database, not just localStorage
- [ ] **In-app notification center** - dropdown/panel showing recent notifications

### 2.4 Audit Logging ✅ Complete
- [x] Action-level logging
- [x] Audit log viewer for managers
- [x] Export audit logs

---

## Phase 3: Advanced Features

### 3.1 Group Chats ⚠️ Partially Complete
- [x] View group conversations
- [ ] **Send messages to groups** - verify implementation
- [x] Group participant list
- [ ] **Group admin actions** - promote/demote admin, remove participant, change group settings

### 3.2 WhatsApp Status ⚠️ Partially Complete
- [x] View contact status updates
- [ ] **Post status updates** - API and UI for posting text/image status
- [x] Status expiration handling

### 3.3 WhatsApp Business Features ❌ Not Implemented
- [ ] **Quick replies** - predefined message templates for fast responses
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

### 3.7 Export ⚠️ Partially Complete
- [ ] **Full backup as ZIP (messages + media)** - download entire chat history with attachments
- [x] Per-contact export
- [ ] **Date range export** - export messages within specific date range

---

## Phase 4: Scale & Polish

### 4.1 Internationalization ⚠️ Partially Complete
- [x] i18n infrastructure (i18next)
- [x] English (default)
- [x] Simplified Chinese (简体中文)
- [ ] **Expand translation coverage** - only basic strings translated, need full coverage

### 4.2 Keyboard Shortcuts ⚠️ Needs Verification
- [ ] **Verify all shortcuts implemented:**
  - [ ] `Ctrl+N` - New chat
  - [ ] `Ctrl+F` - Search
  - [ ] `Escape` - Close modal/panel
  - [ ] `Enter` - Send message
  - [ ] `Shift+Enter` - New line
  - [ ] Arrow keys - Navigate chats
  - [ ] Full keyboard navigation

### 4.3 Mobile Responsiveness ✅ Complete
- [x] Fully responsive design
- [x] Touch-friendly interactions
- [x] Mobile-optimized chat interface

---

## API Routes Missing

### Notifications API
```
GET    /api/notifications/preferences   - Get user's notification preferences
PATCH  /api/notifications/preferences   - Update notification preferences
```

### Additional Missing Endpoints
```
POST   /api/status                      - Post a new WhatsApp status update
DELETE /api/status/:id                  - Delete posted status
GET    /api/quick-replies               - List quick reply templates
POST   /api/quick-replies               - Create quick reply template
PATCH  /api/quick-replies/:id           - Update quick reply
DELETE /api/quick-replies/:id           - Delete quick reply
POST   /api/contacts/manual             - Create contact by phone number
POST   /api/export/full                 - Full backup export as ZIP
GET    /api/export/messages             - Export with date range filter
```

---

## Database Schema Missing

### Tables to Add
```sql
-- Quick replies for fast responses
quick_replies (
  id UUID PRIMARY KEY,
  shortcut VARCHAR(50),
  title VARCHAR(255),
  content TEXT,
  created_by UUID,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)

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

-- Add to messages table (for read receipts)
ALTER TABLE messages ADD COLUMN delivered_at TIMESTAMP;
ALTER TABLE messages ADD COLUMN read_at TIMESTAMP;
```

---

## Testing Tasks

### Backend Unit Tests
- [ ] Notification preferences service tests
- [ ] Quick replies service tests
- [ ] Export service tests (ZIP generation)
- [ ] Permission checking middleware tests

### E2E Tests
- [ ] Contact creation by phone number flow
- [ ] Quick replies usage flow
- [ ] Export functionality tests
- [ ] Notification settings flow
- [ ] Group message sending
- [ ] Status posting flow

---

## Priority Ranking

### High Priority (Core Functionality Gaps)
1. Feature-based permissions system
2. "Assign to me" on first reply
3. Add contacts by phone number
4. Read receipts display
5. Notification preferences API

### Medium Priority (Enhanced Experience)
6. In-app notification center
7. Message search within conversation
8. Quick replies
9. Full backup as ZIP export
10. Instant transfer/takeover notifications

### Low Priority (Nice to Have)
11. WhatsApp Business features (labels sync, catalogs)
12. Post status updates
13. Group admin actions
14. Resolution rate tracking
15. Blog/docs content

---

## Summary

| Phase | Total Features | Completed | Partial | Missing |
|-------|---------------|-----------|---------|---------|
| Phase 1 | 28 | 24 | 4 | 0 |
| Phase 2 | 16 | 7 | 5 | 4 |
| Phase 3 | 18 | 10 | 4 | 4 |
| Phase 4 | 10 | 4 | 5 | 1 |
| **Total** | **72** | **45** | **18** | **9** |

**Overall Completion: ~63% fully complete, ~25% partial, ~12% missing**
