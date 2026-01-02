# WhatsApp Web - Collaborative Business Messaging Platform

## Overview

A multi-tenant collaborative WhatsApp Web client that enables businesses to manage WhatsApp communications with team collaboration features, contact assignment, and comprehensive audit logging.

---

## Tech Stack

### Frontend (React App)
- **Runtime**: Bun
- **Build Tool**: Vite
- **Framework**: React
- **Data Fetching**: TanStack Query
- **State Management**: As needed (TanStack Query for server state, Zustand if client state needed)
- **Styling**: Tailwind CSS v4, shadcn/ui, Radix UI
- **Design**: Minimalist, clean
- **Testing**: Playwright (E2E)
- **i18n**: English + Simplified Chinese (简体中文)
- **Code Quality**: Biome (linter + formatter)

### Marketing Site
- **Framework**: Astro
- **Content**: Landing page, pricing, blog, documentation, changelog
- **Styling**: Tailwind CSS

### Backend (API Server)
- **Runtime**: Bun
- **Framework**: Hono
- **Database**: PostgreSQL (schema-per-tenant)
- **Query Builder**: Kysely
- **Search**: Meilisearch (full-text search with filters)
- **Testing**: TDD approach (unit + integration tests)
- **Email**: Resend
- **Code Quality**: Biome

### WhatsApp Service (Go)
- **Library**: whatsmeow (custom Go service)
- **Architecture**: Process-per-account (isolated)
- **Orchestrator**: Dedicated Go service managing WhatsApp processes
- **Session Storage**: PostgreSQL (per-tenant schema)
- **Code Quality**: golangci-lint

### Message Queue
- **Technology**: NATS JetStream
- **Purpose**: Communication between Go services and Hono backend
- **Features**: Persistence, replay, delivery guarantees

### Media Storage
- **Production**: Cloudflare R2
- **Development**: Local filesystem (R2-compatible interface)
- **Strategy**: Download and store all media on receive

### Infrastructure
- **Containers**: Docker Compose for local development
- **Database**: PostgreSQL (change port if existing port in use)
- **Observability**: Abstract logging interface (provider-agnostic)

### Repository Structure
- **Type**: Monorepo (frontend, backend, Go services)
- **Tool**: Turborepo or similar for task orchestration

---

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Astro Site    │     │   React App     │     │   Mobile Web    │
│   (Marketing)   │     │   (Dashboard)   │     │   (Responsive)  │
└─────────────────┘     └────────┬────────┘     └────────┬────────┘
                                 │                       │
                                 │ WebSocket + REST      │
                                 ▼                       ▼
                        ┌─────────────────────────────────┐
                        │         Hono Backend            │
                        │  (API, Auth, Business Logic)    │
                        └─────────────────┬───────────────┘
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    │                     │                     │
                    ▼                     ▼                     ▼
           ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
           │  PostgreSQL  │     │ NATS JetStream│     │  Meilisearch │
           │  (per-tenant │     │              │     │              │
           │   schemas)   │     └──────┬───────┘     └──────────────┘
           └──────────────┘            │
                                       │
                              ┌────────▼────────┐
                              │  Go Orchestrator │
                              │  (Process Mgmt)  │
                              └────────┬────────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    │                  │                  │
                    ▼                  ▼                  ▼
           ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
           │ WA Process 1 │   │ WA Process 2 │   │ WA Process N │
           │ (Company A)  │   │ (Company B)  │   │ (Company N)  │
           └──────────────┘   └──────────────┘   └──────────────┘
                    │                  │                  │
                    └──────────────────┼──────────────────┘
                                       │
                                       ▼
                              ┌──────────────┐
                              │ Cloudflare R2 │
                              │   (Media)     │
                              └──────────────┘
```

### Process Communication

1. **Browser ↔ Hono**: WebSocket (Hono built-in) for real-time updates, REST for CRUD operations
2. **Hono ↔ Go Services**: NATS JetStream for async messaging
3. **Go Services ↔ WhatsApp**: whatsmeow library (direct WebSocket to WhatsApp servers)

### Multi-Tenancy

- **Database**: Schema-per-tenant isolation
- **Naming**: `tenant_{company_id}` schema per company
- **Public Schema**: Aggregated stats and cross-tenant views for admin
- **Session Data**: Stored in tenant schemas (encryption keys, WhatsApp session)

---

## Database Design

### Public Schema (Cross-Tenant)

```sql
-- Companies
companies (
  id UUID PRIMARY KEY,
  name VARCHAR(255),
  schema_name VARCHAR(100) UNIQUE,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  status ENUM('active', 'suspended', 'deleted')
)

-- Users (global, can belong to companies)
users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE,
  password_hash VARCHAR(255),
  email_verified_at TIMESTAMP,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)

-- Company memberships
company_members (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users,
  company_id UUID REFERENCES companies,
  role VARCHAR(50), -- owner, admin, member
  permissions JSONB, -- feature-based permissions
  invited_by UUID REFERENCES users,
  joined_at TIMESTAMP
)

-- Invitations
invitations (
  id UUID PRIMARY KEY,
  company_id UUID REFERENCES companies,
  email VARCHAR(255),
  token VARCHAR(255) UNIQUE,
  invited_by UUID REFERENCES users,
  expires_at TIMESTAMP,
  accepted_at TIMESTAMP
)

-- Aggregated stats (materialized views)
company_stats (
  company_id UUID PRIMARY KEY,
  total_messages INTEGER,
  total_contacts INTEGER,
  active_users INTEGER,
  last_message_at TIMESTAMP,
  updated_at TIMESTAMP
)

-- User sessions (device-based)
user_sessions (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users,
  device_name VARCHAR(255),
  device_type VARCHAR(50),
  ip_address INET,
  user_agent TEXT,
  last_active_at TIMESTAMP,
  created_at TIMESTAMP,
  expires_at TIMESTAMP
)
```

### Tenant Schema (Per Company)

```sql
-- WhatsApp connections
whatsapp_connections (
  id UUID PRIMARY KEY,
  phone_number VARCHAR(20),
  jid VARCHAR(100), -- WhatsApp JID
  status ENUM('connected', 'disconnected', 'banned', 'pending'),
  connected_by UUID, -- user who connected
  connected_at TIMESTAMP,
  last_sync_at TIMESTAMP,
  session_data BYTEA -- encrypted whatsmeow session
)

-- Contacts
contacts (
  id UUID PRIMARY KEY,
  whatsapp_connection_id UUID REFERENCES whatsapp_connections,
  jid VARCHAR(100),
  phone_number VARCHAR(20),
  push_name VARCHAR(255), -- from WhatsApp
  custom_name VARCHAR(255), -- user-defined
  notes_shared TEXT, -- visible to all team members
  is_group BOOLEAN DEFAULT false,
  profile_picture_url TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)

-- Contact tags
tags (
  id UUID PRIMARY KEY,
  name VARCHAR(100),
  color VARCHAR(7), -- hex color
  created_by UUID,
  created_at TIMESTAMP
)

contact_tags (
  contact_id UUID REFERENCES contacts,
  tag_id UUID REFERENCES tags,
  PRIMARY KEY (contact_id, tag_id)
)

-- Contact assignments
contact_assignments (
  id UUID PRIMARY KEY,
  contact_id UUID REFERENCES contacts,
  assigned_to UUID, -- user_id
  assigned_by UUID, -- user_id
  assigned_at TIMESTAMP,
  unassigned_at TIMESTAMP
)

-- Private contact notes (per user)
contact_notes_private (
  id UUID PRIMARY KEY,
  contact_id UUID REFERENCES contacts,
  user_id UUID,
  content TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)

-- Messages
messages (
  id UUID PRIMARY KEY,
  whatsapp_connection_id UUID REFERENCES whatsapp_connections,
  contact_id UUID REFERENCES contacts,
  message_id VARCHAR(100), -- WhatsApp message ID
  from_me BOOLEAN,
  sender_jid VARCHAR(100),
  message_type ENUM('text', 'image', 'video', 'audio', 'document', 'sticker', 'location', 'contact', 'reaction'),
  content TEXT,
  media_url TEXT,
  media_mime_type VARCHAR(100),
  media_size INTEGER,
  quoted_message_id VARCHAR(100),
  is_forwarded BOOLEAN DEFAULT false,
  is_starred BOOLEAN DEFAULT false,
  deleted_by_sender BOOLEAN DEFAULT false,
  deleted_at TIMESTAMP,
  sent_by_user_id UUID, -- if sent from our app
  timestamp TIMESTAMP,
  created_at TIMESTAMP,

  -- Full-text search (synced to Meilisearch)
  search_vector TSVECTOR
)

-- Message reactions
message_reactions (
  id UUID PRIMARY KEY,
  message_id UUID REFERENCES messages,
  reactor_jid VARCHAR(100),
  emoji VARCHAR(10),
  created_at TIMESTAMP
)

-- Group info (for group chats)
groups (
  id UUID PRIMARY KEY,
  contact_id UUID REFERENCES contacts,
  jid VARCHAR(100),
  name VARCHAR(255),
  description TEXT,
  created_by VARCHAR(100),
  created_at TIMESTAMP,
  participant_count INTEGER
)

group_participants (
  id UUID PRIMARY KEY,
  group_id UUID REFERENCES groups,
  participant_jid VARCHAR(100),
  is_admin BOOLEAN DEFAULT false,
  joined_at TIMESTAMP
)

-- WhatsApp Status (Stories)
status_updates (
  id UUID PRIMARY KEY,
  whatsapp_connection_id UUID REFERENCES whatsapp_connections,
  status_id VARCHAR(100),
  from_jid VARCHAR(100),
  media_type VARCHAR(50),
  media_url TEXT,
  caption TEXT,
  timestamp TIMESTAMP,
  expires_at TIMESTAMP
)

-- Audit logs
audit_logs (
  id UUID PRIMARY KEY,
  user_id UUID,
  action VARCHAR(100), -- 'message_sent', 'contact_assigned', 'chat_takeover', etc.
  entity_type VARCHAR(50),
  entity_id UUID,
  details JSONB,
  ip_address INET,
  created_at TIMESTAMP
)

-- Notification preferences
notification_preferences (
  id UUID PRIMARY KEY,
  user_id UUID,
  sound_enabled BOOLEAN DEFAULT true,
  sound_choice VARCHAR(50) DEFAULT 'default',
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  muted_contacts UUID[], -- array of contact IDs
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)
```

---

## Features

### Phase 1: MVP (Core Flow)

#### 1.1 Marketing Site (Astro)
- Landing page with feature overview
- Pricing page (placeholder for future monetization)
- Blog section (empty initially)
- Documentation section (setup guide)
- Changelog section

#### 1.2 Authentication
- Email + password registration
- Email verification (via Resend)
- Login with email/password
- Password reset flow
- Device-based sessions
- View/manage active sessions
- "Log out all devices" functionality

#### 1.3 Company Setup
- Create new company on registration
- Join company via invite link/code
- Company profile settings

#### 1.4 WhatsApp Connection
- QR code scanning for connection
- Connection status display
- Reconnection handling
- Clear error states when disconnected
- Ban detection with guidance

#### 1.5 Contact Management
- Import contacts on-demand (lazy loading)
- View contact list with search
- Add new contacts by phone number
- Contact profile with WhatsApp info
- Custom contact name
- Shared team notes
- Private personal notes

#### 1.6 Messaging (1:1 Chats)
- Real-time message receiving
- Send text messages
- Send/receive media (images, videos, audio, documents)
- Reply to specific messages
- Forward messages
- Message reactions
- Star messages
- View deleted messages (marked as deleted)
- Read receipts display
- Message search within conversation

#### 1.7 Dashboard
- Message counts (sent, received, today, this week)
- Time-range filters

### Phase 2: Team Collaboration

#### 2.1 Team Management
- Invite team members via email
- Feature-based permissions:
  - `can_view_all_chats`
  - `can_send_messages`
  - `can_assign_contacts`
  - `can_manage_team`
  - `can_export`
  - `can_delete`
  - `can_invite`
- Role presets: Owner, Admin, Agent (customizable)

#### 2.2 Contact Assignment
- Self-assign unassigned contacts
- "Assign to me" on first reply (claims contact)
- View assigned vs all chats filter
- Instant transfer (takeover) with notification
- Assignment history in audit log

#### 2.3 Notifications
- Browser notifications with sound
- Customizable sound choice
- Quiet hours configuration
- Mute specific contacts
- In-app notification center

#### 2.4 Audit Logging
- Action-level logging:
  - Message sent
  - Contact assigned/unassigned
  - Chat takeover
  - Team member invited/removed
  - Permission changes
  - Export actions
- Audit log viewer for managers

### Phase 3: Advanced Features

#### 3.1 Group Chats
- View group conversations
- Send messages to groups
- Group participant list
- Group admin actions (if admin)

#### 3.2 WhatsApp Status
- View contact status updates
- Post status updates
- Status expiration handling

#### 3.3 WhatsApp Business Features
- Quick replies
- Labels (synced with custom tags)
- Catalogs (if Business account)

#### 3.4 Advanced Dashboard
- Response time analytics
- Average reply time
- SLA tracking
- Customer engagement metrics
- Active chats count
- New contacts trend
- Resolution rate (if tracked)

#### 3.5 Contact Organization
- Custom tags/labels (Lead, VIP, Support, etc.)
- Bulk import contacts (CSV/Excel)
- Contact fields: name, notes, tags
- Filter by tags

#### 3.6 Search
- Full-text search across all messages
- Filters: date range, contact, media type
- Meilisearch integration
- Typo-tolerant search

#### 3.7 Export
- Full backup as ZIP (messages + media)
- Per-contact export
- Date range export

### Phase 4: Scale & Polish

#### 4.1 Internationalization
- Full i18n infrastructure
- English (default)
- Simplified Chinese (简体中文)

#### 4.2 Keyboard Shortcuts
- `Ctrl+N` - New chat
- `Ctrl+F` - Search
- `Escape` - Close modal/panel
- `Enter` - Send message
- `Shift+Enter` - New line
- Arrow keys - Navigate chats
- Full keyboard navigation

#### 4.3 Mobile Responsiveness
- Fully responsive design
- Touch-friendly interactions
- Mobile-optimized chat interface

---

## API Design

### REST Endpoints (Hono)

#### Authentication
```
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/logout
POST   /api/auth/verify-email
POST   /api/auth/forgot-password
POST   /api/auth/reset-password
GET    /api/auth/sessions
DELETE /api/auth/sessions/:id
DELETE /api/auth/sessions (logout all)
```

#### Company
```
POST   /api/companies
GET    /api/companies/:id
PATCH  /api/companies/:id
GET    /api/companies/:id/members
POST   /api/companies/:id/invitations
DELETE /api/companies/:id/invitations/:invitationId
POST   /api/invitations/:token/accept
```

#### WhatsApp Connection
```
GET    /api/whatsapp/status
POST   /api/whatsapp/connect
GET    /api/whatsapp/qr
POST   /api/whatsapp/disconnect
```

#### Contacts
```
GET    /api/contacts
GET    /api/contacts/:id
POST   /api/contacts
PATCH  /api/contacts/:id
GET    /api/contacts/:id/messages
POST   /api/contacts/:id/assign
DELETE /api/contacts/:id/assign
```

#### Messages
```
GET    /api/messages
POST   /api/messages
POST   /api/messages/:id/reaction
DELETE /api/messages/:id/reaction
POST   /api/messages/:id/star
DELETE /api/messages/:id/star
POST   /api/messages/:id/forward
```

#### Search
```
GET    /api/search?q=&filters=
```

#### Notifications
```
GET    /api/notifications/preferences
PATCH  /api/notifications/preferences
```

#### Audit
```
GET    /api/audit-logs
```

#### Dashboard
```
GET    /api/dashboard/stats
GET    /api/dashboard/analytics
```

### WebSocket Events (Hono)

#### Client → Server
```
subscribe:company:{companyId}
message:send
message:typing
message:read
contact:assign
```

#### Server → Client
```
message:new
message:update
message:delete
message:reaction
contact:update
contact:assigned
whatsapp:status
notification
```

### NATS Topics

```
# Go → Hono
whatsapp.{companyId}.message.received
whatsapp.{companyId}.message.sent
whatsapp.{companyId}.message.deleted
whatsapp.{companyId}.status.changed
whatsapp.{companyId}.contact.updated
whatsapp.{companyId}.group.updated

# Hono → Go
whatsapp.{companyId}.message.send
whatsapp.{companyId}.connection.connect
whatsapp.{companyId}.connection.disconnect
whatsapp.{companyId}.media.download
```

---

## Security Considerations

### Authentication & Authorization
- JWT tokens with short expiry (15 min) + refresh tokens
- Device-based session tracking
- Permission checks on every API call
- Rate limiting on authentication endpoints

### Data Protection
- Tenant isolation via database schemas
- Encryption at rest for sensitive data (session keys)
- No cross-tenant data leakage
- Audit logging for compliance

### WhatsApp-Specific
- Message rate limiting (mirror WhatsApp limits)
- Ban detection and user notification
- Session data encryption in database

### Input Validation
- Validate all user inputs
- Sanitize message content
- File type validation for uploads

---

## Testing Strategy

### Backend (TDD)
- Unit tests for all business logic
- Integration tests with test database
- Contract tests for Go ↔ Hono communication via NATS
- Mock WhatsApp service for development

### Frontend (E2E)
- Playwright for user flow testing
- Mock backend for UI tests
- Smoke tests with real sandbox (optional)
- Visual regression testing (optional)

### Development Mode
- Mock WhatsApp service simulating:
  - Incoming messages
  - Typing indicators
  - Read receipts
  - Connection states
- Deterministic test data

---

## Error Handling

### Connection States
- **Connected**: Normal operation
- **Disconnected**: Clear error banner, block sending
- **Reconnecting**: Show status, queue disabled
- **Banned**: Notification with guidance, preserve data

### User Feedback
- Toast notifications for actions
- Inline validation errors
- Connection status indicator
- Loading states for all async operations

---

## Performance Considerations

### Database
- Indexes on frequently queried columns
- Pagination for message lists
- Lazy loading of message history
- Materialized views for dashboard stats

### Real-time
- Efficient WebSocket connection management
- Message batching for bulk updates
- Optimistic UI updates

### Media
- Thumbnail generation
- Progressive image loading
- Lazy media download

### Search
- Meilisearch for fast full-text search
- Background indexing of new messages
- Debounced search input

---

## Deployment

### Local Development
```yaml
# docker-compose.yml services
- PostgreSQL (port configurable, avoid conflicts)
- NATS JetStream
- Meilisearch
- Local R2-compatible storage
```

### Production Considerations
- Stateless Hono replicas behind load balancer
- Single Go orchestrator (initially)
- Orchestrator auto-reconnects all accounts on startup
- Health checks for all services

---

## Development Phases (Tasks)

### Phase 1: Foundation
1. Project setup (monorepo, tooling, linting)
2. Docker Compose configuration
3. Database schema + migrations
4. Authentication system
5. Company/tenant setup

### Phase 2: WhatsApp Core
1. Go orchestrator service
2. WhatsApp process management
3. NATS integration
4. QR code connection flow
5. Basic message send/receive

### Phase 3: Chat UI
1. Chat list component
2. Message thread component
3. Message input with media
4. Real-time updates via WebSocket
5. Contact management UI

### Phase 4: Team Features
1. Team invitation system
2. Permission system
3. Contact assignment
4. Audit logging

### Phase 5: Advanced
1. Full-text search with Meilisearch
2. Dashboard analytics
3. Export functionality
4. Group chat support
5. WhatsApp Status

### Phase 6: Polish
1. i18n (English + Chinese)
2. Keyboard shortcuts
3. Mobile responsiveness
4. Performance optimization

---

## References

- [whatsmeow](https://github.com/tulir/whatsmeow) - Go library for WhatsApp Web
- [go-whatsapp-web-multidevice](https://github.com/aldinokemal/go-whatsapp-web-multidevice) - Reference implementation
- [NATS JetStream](https://docs.nats.io/nats-concepts/jetstream) - Message queue documentation
- [Meilisearch](https://www.meilisearch.com/docs) - Search engine documentation
- [Hono WebSocket](https://hono.dev/helpers/websocket) - WebSocket support in Hono
