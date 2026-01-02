# WhatsApp Web Platform - Development Changelog

A comprehensive development log for the Multi-tenant WhatsApp Web Collaborative Business Messaging Platform.

**Last Updated:** 2026-01-02

---

## Latest Updates

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
