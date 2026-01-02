# Task: Complete Remaining Spec Features

## Objective
Complete all remaining features from the WhatsApp Web spec that are not yet implemented, using sub-agents with master orchestration and the ralph-loop handoff pattern.

## Type
Full Stack Completion (Feature Implementation + Integration)

## Current Status
Based on Puppeteer verification, these features are **already working**:
- Phase 1.1: Marketing Site (Landing, Pricing, Docs, Blog, Changelog)
- Phase 1.2: Authentication (Login, Register, Forgot Password)
- Phase 1.3: Company Setup
- Phase 1.5: Contact Management UI (Search, Filters)
- Phase 1.6: Messaging UI (Chat list, conversation panel)
- Phase 2.1: Team Management (Members, Invitations)
- Phase 2.2: Contact Assignment (Filter tabs)
- Phase 2.4: Audit Logging (with Export CSV)
- Phase 4.1: i18n (Language selector)
- Phase 4.2: Keyboard Shortcuts (Settings)
- Phase 4.3: Mobile Responsiveness

## Remaining Features to Implement

### High Priority (Core WhatsApp Functionality)
1. **Phase 1.4: WhatsApp Connection**
   - QR code scanning for connection
   - Connection status display
   - Reconnection handling
   - Ban detection with guidance
   - Go orchestrator <-> Hono API integration via NATS

2. **Phase 1.6: Messaging (Backend)**
   - Real-time message receiving via whatsmeow
   - Send text messages
   - Send/receive media (images, videos, audio, documents)
   - Reply to specific messages
   - Forward messages
   - Message reactions
   - Star messages
   - Read receipts
   - WebSocket real-time updates

3. **Phase 1.7: Dashboard**
   - Message counts (sent, received, today, this week)
   - Time-range filters

### Medium Priority (Team & Advanced)
4. **Phase 2.3: Notifications**
   - Browser notifications with sound
   - Customizable sound choice
   - Quiet hours configuration
   - Mute specific contacts

5. **Phase 3.1: Group Chats**
   - View group conversations
   - Send messages to groups
   - Group participant list

6. **Phase 3.6: Search**
   - Meilisearch integration
   - Full-text search across messages
   - Filters: date range, contact, media type

### Lower Priority (Polish)
7. **Phase 3.2: WhatsApp Status**
   - View contact status updates
   - Post status updates

8. **Phase 3.4: Advanced Dashboard**
   - Response time analytics
   - SLA tracking

9. **Phase 3.5: Contact Organization**
   - Custom tags/labels
   - Bulk import contacts (CSV/Excel)

## Scope

### Files/Directories
- `services/orchestrator/` - Go service managing WhatsApp worker lifecycle
- `services/whatsapp/` - Go WhatsApp client using whatsmeow
- `apps/api/` - Hono backend (NATS integration, WebSocket handlers)
- `apps/web/` - React frontend (real-time updates, new components)
- `packages/database/` - Any new migrations needed
- `change-logs/` - Document progress for each phase

### Reference Patterns
- Check existing code patterns in each directory
- Follow CLAUDE.md conventions
- Use existing middleware chain (CORS, Logger, Auth, Tenant)
- Match current Biome/ESLint formatting

## Requirements

### Acceptance Criteria
- [ ] WhatsApp QR code connection flow works end-to-end
- [ ] Messages can be sent and received in real-time
- [ ] NATS JetStream connects Go services to Hono backend
- [ ] WebSocket delivers real-time updates to frontend
- [ ] Meilisearch indexes and searches messages
- [ ] Group chats display and allow messaging
- [ ] Dashboard shows accurate message statistics
- [ ] All existing tests continue to pass
- [ ] New features have appropriate test coverage

### Constraints
- Flexible approach - make necessary changes as needed
- Follow existing patterns but improve where appropriate
- Document significant changes in change-logs/

## Verification

### Automated Testing
```bash
bun run test                    # All tests
bun run build                   # Build must pass
bun run lint                    # No linting errors
```

### Manual Testing with Puppeteer
- Use Puppeteer MCP to take screenshots of each new feature
- Verify UI components render correctly
- Test real-time updates work
- Document verification with screenshots

### Integration Testing
- Verify NATS message flow between services
- Test WebSocket connections
- Confirm Meilisearch indexing

## Execution Strategy

### Use Sub-Agents with Master Orchestration
Claude should use the `/ralph-wiggum:ralph-loop` command with master orchestrator pattern:

1. **Master Orchestrator** - Coordinates overall progress, manages handoffs
2. **Go Services Agent** - Focus on orchestrator and whatsapp services
3. **Backend Agent** - Focus on Hono API, NATS, WebSocket
4. **Frontend Agent** - Focus on React components, real-time updates
5. **Testing Agent** - Focus on verification, Puppeteer screenshots

### Task Delegation Pattern
```
Master Orchestrator
  |-- Spawn: Go Services Agent (WhatsApp connection, NATS publishing)
  |-- Spawn: Backend Agent (NATS subscription, WebSocket handlers)
  |-- Spawn: Frontend Agent (Real-time UI, new components)
  |-- Verify: Testing Agent (Run tests, Puppeteer verification)
  |-- Document: Update change-logs/
```

### Handoff Protocol
- Each sub-agent completes their scope and reports back
- Master orchestrator tracks progress in TodoWrite
- Create change-log entry after each major milestone
- Use Puppeteer MCP to screenshot and verify before marking complete

## Additional Context

### Architecture Reminder
```
Browser <--WebSocket/REST--> Hono API <--NATS JetStream--> Go Services <--whatsmeow--> WhatsApp
```

### Key Commands
```bash
# Development
bun run dev                     # Start all apps

# Database
bun run db:migrate              # Run migrations
bun run db:generate             # Generate Kysely types

# Go Services
cd services/orchestrator && go run main.go
cd services/whatsapp && go run main.go

# Testing
cd apps/api && bun test         # Backend tests
cd apps/web && bunx playwright test  # E2E tests
```

### Change Log Format
Create entries in `change-logs/` following existing format:
- `phase-1.4-whatsapp-connection.md`
- `phase-1.6-messaging-backend.md`
- etc.

## Start Command
To begin this work, run:
```
/ralph-wiggum:ralph-loop
```

Then reference this prompt file for context and task breakdown.
