# WhatsApp Web Platform - Technical Overview

A multi-tenant WhatsApp Web collaborative business messaging platform. Enables businesses to manage WhatsApp communications with team collaboration, contact assignment, and audit logging.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Project Statistics](#project-statistics)
3. [Monorepo Structure](#monorepo-structure)
4. [Technology Stack](#technology-stack)
5. [Backend API](#backend-api)
6. [Frontend Application](#frontend-application)
7. [Go Services](#go-services)
8. [Database Design](#database-design)
9. [Shared Packages](#shared-packages)
10. [Real-time Communication](#real-time-communication)
11. [Development Guide](#development-guide)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          FRONTEND (React + Vite)                                 │
│                         apps/web (port 4444)                                     │
│  ┌───────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │  TanStack     │  │   Zustand    │  │    React     │  │  WebSocket Client  │  │
│  │    Query      │  │   Stores     │  │   Contexts   │  │  (Real-time)       │  │
│  └───────────────┘  └──────────────┘  └──────────────┘  └────────────────────┘  │
└──────────────────────────────────┬──────────────────────────────────────────────┘
                                   │ HTTP REST / WebSocket
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          BACKEND API (Hono + Bun)                                │
│                         apps/api (port 4445)                                     │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                      Middleware Chain                                     │   │
│  │ CORS → Logger → Rate Limiter → Auth → Tenant Context → Route Handler    │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐  ┌──────────────┐   │
│  │  21 Route      │  │  26+ Service   │  │   NATS         │  │  WebSocket   │   │
│  │  Modules       │  │  Files         │  │   Publisher    │  │  Server      │   │
│  └────────────────┘  └────────────────┘  └────────────────┘  └──────────────┘   │
└──────────────────────────────────┬──────────────────────────────────────────────┘
                                   │ NATS JetStream
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            GO SERVICES                                           │
│  ┌─────────────────────────────────┐  ┌──────────────────────────────────────┐  │
│  │          Orchestrator           │  │        WhatsApp Workers              │  │
│  │    services/orchestrator        │──▶│      services/whatsapp               │  │
│  │  ┌───────────────────────────┐  │  │  ┌────────────────────────────────┐  │  │
│  │  │ Process Manager           │  │  │  │ whatsmeow Client Wrapper       │  │  │
│  │  │ Worker Lifecycle          │  │  │  │ Event Handler (Message/Media)  │  │  │
│  │  │ Health Monitoring         │  │  │  │ NATS Publisher/Subscriber      │  │  │
│  │  │ NATS Command Listener     │  │  │  │ S3 Storage Client              │  │  │
│  │  └───────────────────────────┘  │  │  └────────────────────────────────┘  │  │
│  └─────────────────────────────────┘  └──────────────────────────────────────┘  │
└──────────────────────────────────┬──────────────────────────────────────────────┘
                                   │ whatsmeow library
                                   ▼
                            [ WhatsApp Network ]
```

---

## Project Statistics

| Category              | Count | Notes                               |
|-----------------------|-------|-------------------------------------|
| Backend Route Files   | 57    | apps/api/src/routes/                |
| Backend Service Files | 56    | apps/api/src/services/              |
| Backend Middleware    | 7     | apps/api/src/middleware/            |
| Frontend Components   | 135   | apps/web/src/components/            |
| Frontend Hooks        | 68    | apps/web/src/hooks/                 |
| Frontend Pages        | 10    | apps/web/src/pages/                 |
| UI Components         | 21    | apps/web/src/components/ui/         |
| API Client Files      | 15    | apps/web/src/lib/api/               |
| Database Migrations   | 31    | packages/database/src/migrations/   |
| Go Source Files       | 35    | services/ (excluding tests)         |

---

## Monorepo Structure

```
whatsapp-web/
├── apps/
│   ├── api/                    # Hono + Bun backend API (port 4445)
│   │   ├── src/
│   │   │   ├── config/         # Rate limiting, cleanup configs
│   │   │   ├── lib/            # Utilities (15 files)
│   │   │   │   ├── nats/       # NATS client and types
│   │   │   │   ├── schemas/    # Zod validation schemas
│   │   │   │   ├── errors.ts   # Error classes
│   │   │   │   ├── jwt.ts      # JWT utilities
│   │   │   │   ├── email.ts    # Resend email client
│   │   │   │   ├── storage.ts  # S3/MinIO client
│   │   │   │   └── response.ts # Response helpers
│   │   │   ├── middleware/     # Request middleware (7 files)
│   │   │   │   ├── auth.ts     # JWT verification
│   │   │   │   ├── tenant.ts   # Multi-tenant context
│   │   │   │   ├── role.ts     # Role-based access
│   │   │   │   ├── permission.ts # Permission checking
│   │   │   │   └── rate-limit.ts # Rate limiting
│   │   │   ├── routes/         # API route handlers
│   │   │   │   ├── auth/       # Login, register, session (8 files)
│   │   │   │   ├── contacts/   # CRUD, import, notes, tags (5 files)
│   │   │   │   ├── messages/   # Send, fetch, reactions (6 files)
│   │   │   │   ├── whatsapp/   # Connection management
│   │   │   │   ├── ws/         # WebSocket handling
│   │   │   │   ├── companies/  # Company management
│   │   │   │   ├── conversations/
│   │   │   │   ├── groups/
│   │   │   │   └── [12 more route files]
│   │   │   ├── services/       # Business logic (26+ files)
│   │   │   │   ├── analytics/
│   │   │   │   ├── company/
│   │   │   │   ├── export/
│   │   │   │   ├── handlers/   # NATS event handlers
│   │   │   │   ├── helpers/
│   │   │   │   ├── import/
│   │   │   │   ├── whatsapp/
│   │   │   │   └── *.service.ts
│   │   │   └── __tests__/      # Unit & integration tests
│   │   └── package.json
│   │
│   ├── web/                    # React + Vite frontend (port 4444)
│   │   ├── src/
│   │   │   ├── components/     # React components (15 directories)
│   │   │   │   ├── auth/       # Login, register forms
│   │   │   │   ├── chat/       # 30+ chat components
│   │   │   │   │   ├── ChatList.tsx
│   │   │   │   │   ├── MessageThread.tsx
│   │   │   │   │   ├── MessageBubble.tsx
│   │   │   │   │   ├── MessageComposer.tsx
│   │   │   │   │   ├── contact-profile/
│   │   │   │   │   └── notes/
│   │   │   │   ├── contacts/
│   │   │   │   ├── dashboard/
│   │   │   │   ├── export/
│   │   │   │   ├── groups/
│   │   │   │   ├── layout/
│   │   │   │   ├── notifications/
│   │   │   │   ├── search/
│   │   │   │   ├── settings/
│   │   │   │   ├── status/
│   │   │   │   ├── team/
│   │   │   │   ├── ui/         # 22 shared UI components
│   │   │   │   └── whatsapp/
│   │   │   ├── contexts/       # React contexts
│   │   │   │   ├── auth-context.tsx
│   │   │   │   ├── theme-context.tsx
│   │   │   │   ├── message-actions-context.tsx
│   │   │   │   ├── KeyboardShortcutsContext.tsx
│   │   │   │   └── websocket/  # WebSocket context modules
│   │   │   ├── hooks/          # Custom hooks (35+ files)
│   │   │   │   ├── ui/         # UI interaction hooks (10 files)
│   │   │   │   ├── notification/
│   │   │   │   ├── analytics/
│   │   │   │   ├── chat/
│   │   │   │   ├── contact/
│   │   │   │   ├── messages/
│   │   │   │   ├── query/
│   │   │   │   ├── websocket/
│   │   │   │   ├── whatsapp/
│   │   │   │   └── use*.ts     # Feature hooks
│   │   │   ├── lib/            # Utilities
│   │   │   │   ├── api/        # API client (15 files)
│   │   │   │   ├── schemas/    # Zod schemas (7 files)
│   │   │   │   ├── websocket/  # WebSocket client
│   │   │   │   └── utils.ts
│   │   │   ├── pages/          # 11 page components
│   │   │   ├── stores/         # Zustand stores
│   │   │   │   ├── chat/       # Modular chat store (6 slices)
│   │   │   │   └── websocket-store.ts
│   │   │   ├── types/          # TypeScript types
│   │   │   └── locales/        # i18n translations
│   │   ├── e2e/                # Playwright E2E tests
│   │   └── package.json
│   │
│   └── marketing/              # Astro marketing site (port 4446)
│       └── src/
│           ├── layouts/
│           └── pages/
│
├── packages/
│   ├── database/               # Kysely database client
│   │   ├── src/
│   │   │   ├── migrations/     # 30 migration files
│   │   │   │   └── migration-helpers.ts
│   │   │   ├── types/
│   │   │   ├── client.ts       # Connection factory
│   │   │   ├── migrator.ts
│   │   │   └── index.ts
│   │   └── migrate.ts          # CLI runner
│   │
│   ├── shared/                 # Shared TypeScript types & utils
│   │   └── src/
│   │       ├── types/          # Core types
│   │       │   ├── message.ts  # MessageType, MessageStatus
│   │       │   ├── company.ts  # CompanyStatus, CompanyMemberRole
│   │       │   └── user.ts
│   │       ├── date.ts         # dayjs utilities (50+ functions)
│   │       ├── phone.ts        # Phone formatting
│   │       ├── jid.ts          # WhatsApp JID utilities
│   │       ├── contact.ts      # Contact display helpers
│   │       ├── user-utils.ts   # Avatar, initials
│   │       └── websocket-types.ts # 60+ WebSocket types
│   │
│   └── ui/                     # Shared React components
│       └── src/
│           └── components/
│               └── button.tsx
│
├── services/
│   ├── orchestrator/           # Go process manager
│   │   ├── internal/
│   │   │   ├── api/            # HTTP health/status API
│   │   │   ├── manager/        # Worker lifecycle (6 files)
│   │   │   ├── nats/           # NATS client and streams
│   │   │   └── types/
│   │   ├── main.go
│   │   └── go.mod
│   │
│   ├── whatsapp/               # Go WhatsApp client
│   │   ├── internal/
│   │   │   ├── client/         # whatsmeow wrapper (3 files)
│   │   │   ├── handler/        # Event handlers (10 files)
│   │   │   │   ├── handler.go  # Main dispatcher
│   │   │   │   ├── messages.go # Message processing
│   │   │   │   ├── media.go    # Media upload
│   │   │   │   ├── history_sync.go
│   │   │   │   ├── connection.go
│   │   │   │   └── download.go # On-demand media
│   │   │   ├── nats/           # Publisher/subscriber (4 files)
│   │   │   ├── storage/        # S3/MinIO client
│   │   │   ├── store/          # PostgreSQL session store
│   │   │   └── types/
│   │   ├── main.go
│   │   └── go.mod
│   │
│   └── shared/                 # Shared Go utilities
│       ├── config/             # Environment helpers (2 files)
│       ├── nats/               # NATS utilities (8 files)
│       │   ├── connection.go
│       │   ├── events.go       # 30+ event/payload types
│       │   ├── streams.go
│       │   └── subjects.go
│       └── go.mod
│
├── vendor/
│   └── whatsmeow/              # WhatsApp Web API library (git submodule)
│
├── docs/                       # Documentation
│   ├── overview.md             # This file
│   ├── websocket-flow.md
│   ├── whatsapp-connection-flow.md
│   ├── whatsapp-sync-flow.md
│   └── typing-indicator-flow.md
│
├── scripts/                    # Utility scripts
│   ├── init-db.sql
│   ├── clean-db.sh
│   ├── clean-nats.sh
│   └── run-tests.sh
│
├── docker-compose.yml          # Infrastructure services
├── turbo.json                  # Turborepo config
├── package.json                # Workspace root
└── CLAUDE.md                   # AI assistant instructions
```

---

## Technology Stack

| Layer           | Technology                                                                    |
|-----------------|-------------------------------------------------------------------------------|
| **Frontend**    | React 19, Vite 6, TanStack Query v5, Zustand v5, Tailwind CSS v4, Radix UI   |
| **Backend**     | Hono v4, Bun runtime, Kysely (SQL builder), PostgreSQL 16                    |
| **Go Services** | Go 1.24, whatsmeow, NATS JetStream                                           |
| **Search**      | Meilisearch v1.11                                                            |
| **Queue**       | NATS JetStream (at-least-once delivery)                                      |
| **Storage**     | Cloudflare R2 / MinIO (S3-compatible)                                        |
| **Email**       | Resend                                                                       |
| **Testing**     | Bun test (backend), Playwright (E2E)                                         |

### Infrastructure Ports

| Service       | Port  | Purpose                          |
|---------------|-------|----------------------------------|
| Frontend      | 4444  | React development server         |
| API           | 4445  | Hono REST API + WebSocket        |
| Marketing     | 4446  | Astro marketing site             |
| PostgreSQL    | 4447  | Primary database                 |
| NATS          | 4448  | Message queue                    |
| Meilisearch   | 4449  | Full-text search                 |
| MinIO         | 4450  | Object storage (S3-compatible)   |

---

## Backend API

### Middleware Chain

```
Request
   │
   ├──▶ CORS Middleware
   │    Origins: localhost:4444, localhost:3000
   │    Headers: X-Company-ID
   │
   ├──▶ Logger Middleware
   │    Request/response logging (pino)
   │
   ├──▶ Rate Limiter
   │    Global: 100 req/min per IP
   │    Auth: 10 req/min
   │
   ├──▶ Auth Middleware
   │    JWT verification
   │    User context injection
   │    Session activity tracking
   │
   ├──▶ Tenant Middleware
   │    Extract X-Company-ID header
   │    Validate user membership
   │    Switch to tenant schema
   │    Inject tenantDb into context
   │
   └──▶ Route Handler
```

### API Routes

| Route            | Methods                  | Description                          |
|------------------|--------------------------|--------------------------------------|
| `/api/auth`      | POST                     | Login, register, refresh, logout     |
| `/api/companies` | GET, POST, PUT, DELETE   | Company CRUD, members                |
| `/api/invitations` | GET, POST, DELETE      | Team invitations                     |
| `/api/contacts`  | GET, POST, PUT, DELETE   | Contact management, import, notes    |
| `/api/messages`  | GET, POST                | Message history, send, reactions     |
| `/api/conversations` | GET, PUT             | Conversation states, read receipts   |
| `/api/groups`    | GET                      | Group chat metadata                  |
| `/api/whatsapp`  | GET, POST, DELETE        | Connection management, QR codes      |
| `/api/tags`      | GET, POST, PUT, DELETE   | Contact tagging                      |
| `/api/labels`    | GET, POST                | WhatsApp label sync                  |
| `/api/catalogs`  | GET, POST                | Product catalog sync                 |
| `/api/audit`     | GET                      | Audit log viewer                     |
| `/api/analytics` | GET                      | Dashboard statistics                 |
| `/api/export`    | GET, POST                | Data export (CSV, JSON)              |
| `/api/search`    | GET                      | Full-text search (Meilisearch)       |
| `/api/notifications` | GET, PUT             | Notification preferences             |
| `/api/quick-replies` | GET, POST, PUT, DELETE | Quick reply templates             |
| `/api/status`    | GET, POST                | WhatsApp status updates              |
| `/api/media`     | POST                     | Media upload (FormData)              |
| `/api/ws`        | WebSocket                | Real-time events                     |
| `/api/health`    | GET                      | Health check                         |

### Services Architecture

```
services/
├── auth.service.ts              # User auth, sessions, JWT
├── tenant.service.ts            # Tenant connection pool
├── company.service.ts           # Company CRUD
├── contact.service.ts           # Contact management
├── message-handler.ts           # NATS event processing
├── whatsapp.service.ts          # WhatsApp operations
├── whatsapp-connection.service.ts # Connection lifecycle
├── search.service.ts            # Meilisearch integration
├── meilisearch.service.ts       # Search index management
├── analytics.service.ts         # Stats aggregation
├── audit.service.ts             # Activity logging
├── export.service.ts            # Data export
├── permission.service.ts        # RBAC checks
├── notification-*.service.ts    # Notification system
├── quick-replies.service.ts     # Template management
├── label-sync.service.ts        # WhatsApp label sync
├── catalog-sync.service.ts      # Product catalog sync
├── message-cleanup.service.ts   # Periodic cleanup
├── conversation-state.service.ts # Read states
├── note.service.ts              # Contact notes
└── user.service.ts              # User management
```

### Error Handling

```typescript
// Base error class
class AppError extends Error {
  statusCode: number;
  details?: unknown;
}

// Specific errors
class NotFoundError extends AppError { /* 404 */ }
class ValidationError extends AppError { /* 400 */ }
class UnauthorizedError extends AppError { /* 401 */ }
class ForbiddenError extends AppError { /* 403 */ }
class ConflictError extends AppError { /* 409 */ }
class TooManyRequestsError extends AppError { /* 429 */ }
class ServiceUnavailableError extends AppError { /* 503 */ }

// Domain errors
class CompanyNotFoundError extends NotFoundError
class ConnectionNotFoundError extends NotFoundError
class MaxConnectionsExceededError extends TooManyRequestsError
class InvitationExpiredError extends ValidationError
class UserAlreadyMemberError extends ConflictError
```

### Response Helpers

```typescript
// Standard response patterns
successData(c, data)                    // { data: T }
successPaginated(c, data, pagination)   // { data: T[], pagination }
successMessage(c, "message")            // { message: string }
created(c, data)                        // { data: T } with 201
validationError(c, details)             // { error, details } with 400
```

---

## Frontend Application

### Pages

| Route              | Component            | Auth     | Description                    |
|--------------------|----------------------|----------|--------------------------------|
| `/login`           | LoginPage            | Public   | User login                     |
| `/register`        | RegisterPage         | Public   | User registration              |
| `/forgot-password` | ForgotPasswordPage   | Public   | Password reset                 |
| `/company-setup`   | CompanySetupPage     | Auth     | Initial company setup          |
| `/chat`            | ChatPage             | Auth+Co  | Main chat interface            |
| `/chat/:contactId` | ChatPage             | Auth+Co  | Chat with specific contact     |
| `/team`            | TeamPage             | Auth+Co  | Team management                |
| `/settings`        | SettingsPage         | Auth+Co  | User settings                  |
| `/audit`           | AuditPage            | Auth+Co  | Audit log viewer               |
| `/dashboard`       | DashboardPage        | Auth+Co  | Analytics dashboard            |
| `/invite/:token`   | AcceptInvitationPage | Auth     | Accept team invitation         |

### State Management

#### TanStack Query (Server State)

```typescript
// Query key factory pattern
const queryKeys = {
  contacts: {
    all: ['contacts'] as const,
    list: (filters) => [...queryKeys.contacts.all, 'list', filters],
    detail: (id) => [...queryKeys.contacts.all, 'detail', id],
  },
  messages: {
    byContact: (contactId) => ['messages', contactId],
  },
}

// Custom hooks wrap queries
const { data } = useContacts(filters)
const { data: messages } = useInfiniteMessages(contactId)
```

#### Zustand (Client State)

```typescript
// Modular chat store with slices
const useChatStore = create<ChatState>()((set, get) => ({
  // conversation-slice.ts
  selectedContactId: null,
  setSelectedContactId: (id) => set({ selectedContactId: id }),

  // messages-slice.ts
  optimisticMessages: new Map(),
  addOptimisticMessage: (msg) => ...,

  // drafts-slice.ts
  drafts: new Map(),
  setDraft: (contactId, content) => ...,

  // selection-slice.ts
  selectedMessageIds: new Set(),
  toggleMessageSelection: (id) => ...,

  // typing-slice.ts
  typingIndicators: new Map(),
}))
```

#### React Contexts

```typescript
// AuthContext - User session and companies
const { user, isAuthenticated, login, logout, companies } = useAuth()

// ThemeContext - Dark mode
const { theme, setTheme, toggleTheme, resolvedTheme } = useTheme()

// MessageActionsContext - Avoids prop drilling
const { onReply, onForward, onDelete, onStar, onReact } = useMessageActions()

// KeyboardShortcutsContext - Global shortcuts
const { registerShortcut } = useKeyboardShortcuts()
```

### Component Organization

```
components/
├── auth/            # Login, register forms, ProtectedRoute
├── chat/            # Core chat UI (30+ files)
│   ├── ChatList.tsx, ChatListItem.tsx
│   ├── ChatListSearch.tsx
│   ├── ChatSidebar.tsx
│   ├── MessageThread.tsx
│   ├── VirtualMessageList.tsx
│   ├── MessageBubble.tsx
│   ├── MessageComposer.tsx
│   ├── MessageContextMenu.tsx
│   ├── MessageReactions.tsx
│   ├── EmojiInputPicker.tsx
│   ├── EmojiReactionPicker.tsx
│   ├── ForwardMessageDialog.tsx
│   ├── DeleteMessageDialog.tsx
│   ├── contact-profile/         # Contact details panel
│   └── notes/                   # Contact notes
├── contacts/        # Contact list, form, details
├── dashboard/       # Stats widgets, charts
├── export/          # Export dialog, progress
├── groups/          # Group list, details
├── layout/          # Sidebar, header, navigation
├── notifications/   # Notification center
├── search/          # Global search
├── settings/        # Settings panels, keyboard shortcuts
├── status/          # Status viewer
├── team/            # Team management, invites
├── ui/              # 22 shared components
│   ├── button.tsx, input.tsx, textarea.tsx
│   ├── dialog.tsx, confirmation-dialog.tsx
│   ├── tabs.tsx, step-wizard.tsx
│   ├── loading-spinner.tsx, skeleton.tsx
│   ├── avatar.tsx, badge.tsx
│   ├── popover.tsx, tooltip.tsx
│   ├── scroll-area.tsx, select.tsx
│   ├── form-field.tsx, checkbox.tsx
│   ├── ellipsis-menu.tsx
│   └── async-data-renderer.tsx
└── whatsapp/        # Connection status, QR code
```

### Custom Hooks

```
hooks/
├── ui/                          # UI interaction (10 files)
│   ├── useClickOutside.ts
│   ├── useDebounce.ts
│   ├── useMediaQuery.ts
│   ├── useSwipeGesture.ts
│   ├── useKeyboardShortcuts.ts
│   ├── useTextareaAutoResize.ts
│   ├── useElementPosition.ts
│   ├── useViewportBoundedPosition.ts
│   └── useFormState.ts
├── notification/
│   ├── useNotifications.ts
│   └── useNotificationCenter.ts
├── analytics/
│   └── useAnalytics.ts
├── chat/
│   └── useChatPageState.ts
├── useAsyncData.tsx             # Async data wrapper with renderState()
├── useChats.ts                  # Chat list
├── useContact.ts                # Contact details
├── useMessages.ts               # Message history
├── useInfiniteMessages.ts       # Infinite scroll
├── useConversationState.ts      # Read states
├── useWebSocket.ts              # WebSocket connection
├── useWhatsAppConnection.ts     # WhatsApp status
├── useWhatsAppConnections.ts    # Multiple connections
├── useTeam.ts                   # Team members
├── useAudit.ts                  # Audit log
├── useExport.ts                 # Data export
├── useSearch.ts                 # Search
├── useQuickReplies.ts           # Templates
├── useLabels.ts                 # WhatsApp labels
├── useCatalogs.ts               # Product catalogs
├── useGroups.ts                 # Group chats
├── useStatus.ts                 # Status updates
├── usePermissions.ts            # RBAC
└── useSyncStatus.ts             # Sync progress
```

### API Client

```typescript
// apps/web/src/lib/api/client.ts

// Automatic token handling
const { data } = await fetchWithAuth<T>('/contacts', options)

// Features:
// - Auto-refresh on 401
// - Auto-inject Authorization header
// - Auto-inject X-Company-ID header

// FormData uploads (no Content-Type header)
await fetchFormDataWithAuth('/media', formData)

// Convenience API object
const data = await api.get<User>('/users/me')
const created = await api.post<Contact>('/contacts', { phone: '...' })
await api.delete('/contacts/123')
```

---

## Go Services

### Orchestrator (`services/orchestrator`)

Manages WhatsApp worker process lifecycle.

```go
// Worker process management
type WorkerProcess struct {
    ID           string
    CompanyID    string
    ConnectionID string
    TenantSchema string
    Status       string     // starting, connecting, connected, stopping, stopped, error
    PID          int
    StartedAt    time.Time
    LastActivity time.Time
}

// Key operations
func (m *Manager) SpawnWorker(ctx, companyID, connectionID, tenantSchema, databaseURL) error
func (m *Manager) StopWorker(ctx, companyID, connectionID, reason) error
func (m *Manager) GetWorkerStatus(connectionID) (*WorkerProcess, bool)
func (m *Manager) ListWorkers() []*WorkerProcess
```

**Components:**

```
internal/
├── api/       # HTTP health/status API
├── manager/   # Worker lifecycle (6 files)
│   ├── manager.go      # Process spawning, health checks
│   ├── handlers.go     # NATS command handling
│   └── interfaces.go
├── nats/      # NATS client and streams
└── types/
```

### WhatsApp Worker (`services/whatsapp`)

One process per WhatsApp connection using whatsmeow library.

```go
// Client wrapper
type Client struct {
    client     *whatsmeow.Client
    container  *store.PGContainer
    device     *waStore.Device
    qrCallback QRCallback
    statusCb   StatusCallback
}

// Key operations
func (c *Client) Connect(ctx) error
func (c *Client) Disconnect()
func (c *Client) SendTextMessage(to, text, quotedID) (string, error)
func (c *Client) SendMediaMessage(to, mediaType, content, caption) (string, error)
```

**Components:**

```
internal/
├── client/    # whatsmeow wrapper
│   └── client.go       # 850+ lines, reconnection logic
├── handler/   # Event handlers (10 files)
│   ├── handler.go      # Main event dispatcher
│   ├── messages.go     # Incoming messages
│   ├── media.go        # Media download/upload
│   ├── history_sync.go # Initial sync (10 parallel workers)
│   ├── connection.go   # QR, connect, disconnect events
│   └── download.go     # On-demand media download
├── nats/      # Publisher/subscriber (4 files)
│   ├── publisher.go    # Publish events to API
│   └── subscriber.go   # Listen for send commands
├── storage/   # S3/MinIO client
└── store/     # PostgreSQL session storage
```

**Media Download Retry:**

```go
// Exponential backoff for media downloads
const (
    mediaDownloadMaxRetries = 4        // 4 total attempts
    mediaDownloadBaseDelay = 1s        // 1s, 2s, 4s backoff
    mediaDownloadAttemptTimeout = 30s  // Per-attempt timeout
)
```

### Shared Go Module (`services/shared`)

```go
// Config utilities
natsURL := config.GetEnv("NATS_URL", "nats://localhost:4222")
timeout := config.GetDurationEnv("TIMEOUT", 30*time.Second)
port := config.GetIntEnv("PORT", 8080)
required := config.GetEnvRequired("DATABASE_URL")

// NATS connection
conn, _ := nats.NewConnection(ctx, nats.ConnectionConfig{
    URL:  natsURL,
    Name: "my-service",
})

// Event types (30+ types defined)
const (
    EventTypeQR          = "qr"
    EventTypeConnected   = "connected"
    EventTypeMessage     = "message"
    EventTypeReceipt     = "receipt"
    EventTypePresence    = "presence"
    EventTypeTyping      = "typing"
    EventTypeReaction    = "reaction"
    EventTypeSyncStatus  = "sync_status"
    ...
)

// Payload structs
type MessagePayload struct {
    MessageID       string `json:"messageId"`
    From            string `json:"from"`
    Content         string `json:"content"`
    MessageType     string `json:"messageType"`
    MediaURL        string `json:"mediaUrl,omitempty"`
    IsHistorySync   bool   `json:"isHistorySync,omitempty"`
    ...
}
```

---

## Database Design

### Multi-Tenancy Architecture

**Schema-per-tenant** isolation in PostgreSQL.

```
PostgreSQL
├── public schema                  # Cross-tenant data
│   ├── companies                  # Company registry
│   ├── users                      # User accounts
│   ├── company_members            # User-company relationships
│   ├── invitations                # Pending invitations
│   ├── company_stats              # Aggregated stats
│   └── user_sessions              # Active JWT sessions
│
├── tenant_{company_id} schema     # Per-company data
│   ├── whatsapp_connections       # Device connections
│   ├── contacts                   # Contact directory
│   ├── messages                   # Message history
│   ├── message_reactions          # Emoji reactions
│   ├── groups                     # Group metadata
│   ├── group_participants         # Group members
│   ├── tags                       # Contact tags
│   ├── contact_tags               # Tag assignments
│   ├── contact_assignments        # Contact ownership
│   ├── contact_notes_private      # Private notes
│   ├── contact_notes_shared       # Team notes
│   ├── audit_logs                 # Activity log
│   ├── notification_preferences   # User preferences
│   ├── notification_history       # Notification log
│   ├── quick_replies              # Message templates
│   ├── conversation_states        # Read receipts
│   ├── whatsapp_labels            # Synced labels
│   ├── whatsapp_catalogs          # Product catalogs
│   ├── catalog_products           # Catalog items
│   └── status_updates             # Status stories
│
└── whatsapp_sessions schema       # WhatsApp session data
    └── whatsmeow_*                # whatsmeow session tables
```

### Key Types

```sql
-- Enums
CREATE TYPE company_status AS ENUM ('active', 'suspended', 'deleted');
CREATE TYPE member_role AS ENUM ('owner', 'admin', 'member');
CREATE TYPE message_type AS ENUM ('text', 'image', 'video', 'audio', 'document', 'sticker', 'location', 'contact', 'reaction', 'template');
CREATE TYPE message_status AS ENUM ('pending', 'sent', 'delivered', 'read', 'failed');
```

### Migrations

30 migration files with key milestones:

- `001`: Public schema (companies, users, members)
- `002`: Tenant schema template function
- `015`: **CRITICAL** - Baseline fix, `setup_tenant_schema()` as single source of truth
- `027`: Message deduplication constraint
- `029-030`: Reaction unique constraint

---

## Shared Packages

### `@whatsapp-web/shared`

Single source of truth for TypeScript types.

```typescript
// Core types
export type MessageType = "text" | "image" | "video" | "audio" | "document" | "sticker" | "location" | "contact" | "reaction" | "template"
export type MessageStatus = "pending" | "sent" | "delivered" | "read" | "failed"
export type CompanyStatus = "active" | "suspended" | "deleted"
export type CompanyMemberRole = "owner" | "admin" | "member"

// Date utilities (dayjs-based, 50+ functions)
export { now, nowMs, toDbDate, toISOString, parseDate }
export { formatMessageTime, formatChatListTime, formatRelativeTime, formatAuditTime }
export { subtractDays, addDays, getDateRange, isToday, isYesterday }

// Phone utilities
export { formatPhoneNumber, formatPhoneNumberWithGroups, parsePhoneFromJid }

// JID utilities
export { isGroupJid, extractPhoneFromJid }

// WebSocket types (60+ types)
export type ServerToClientEventType = 'message:new' | 'message:status' | 'qr' | 'connected' | ...
export type ClientToServerMessageType = 'auth' | 'ping' | 'send_message' | 'typing:start' | ...
```

### `@whatsapp-web/database`

Kysely database client with type-safe schemas.

```typescript
// Database clients
export function createDatabase(connectionString: string): Kysely<Database>
export function createTenantDatabase(connectionString, schemaName): Kysely<TenantDatabase>
export function getTenantSchemaName(companyId: string): string

// Table types
export interface Database { companies, users, company_members, invitations, ... }
export interface TenantDatabase { contacts, messages, whatsapp_connections, ... }
```

---

## Real-time Communication

### WebSocket Events

```typescript
// Server → Client (35+ event types)
type ServerToClientEventType =
  | 'auth_success' | 'auth_error'                    // Auth
  | 'qr' | 'connected' | 'disconnected'              // WhatsApp
  | 'message:new' | 'message:status' | 'message:deleted' | 'message:reaction'
  | 'conversation:updated' | 'conversation:read'
  | 'presence:online' | 'presence:offline'
  | 'typing:start' | 'typing:stop'
  | 'media:downloaded' | 'media:download_failed'
  | 'sync:start' | 'sync:progress' | 'sync:complete'
  | 'notification:new'
  | 'error' | 'pong' | 'send_ack' | 'receipt'

// Client → Server
type ClientToServerMessageType =
  | 'auth' | 'ping' | 'send_message' | 'typing:start' | 'typing:stop'
```

### NATS Subjects

```
# Commands (API → Orchestrator)
WHATSAPP.commands.{companyId}.{connectionId}

# Events (Worker → API)
WHATSAPP.events.{companyId}.{connectionId}.{eventType}

# Send commands (API → Worker)
WHATSAPP.send.{companyId}.{connectionId}

# Download requests (API → Worker)
WHATSAPP.download.{companyId}.{connectionId}
```

### Message Flow Example

```
1. WhatsApp → whatsmeow event
2. handler.handleMessage() processes
3. Upload media to S3 (if applicable)
4. Publish to NATS: WHATSAPP.events.{companyId}
5. API receives event
6. Save to tenant database
7. Index in Meilisearch
8. Broadcast to WebSocket clients
9. Frontend updates via React Query
```

---

## Development Guide

### Quick Start

```bash
# 1. Start infrastructure
docker-compose up -d

# 2. Install dependencies
bun install

# 3. Run migrations
bun run db:migrate

# 4. Start all services
bun run dev
```

### Commands Reference

```bash
# Development
bun run dev              # Start all apps (turbo)
bun run build            # Build all apps
bun run lint             # ESLint + Biome
bun run format           # Format code

# Testing
bun run test                           # All tests
cd apps/api && bun test                # Backend tests
cd apps/api && bun test:services       # Service tests only
cd apps/api && bun test:routes         # Route tests only
cd apps/web && bunx playwright test    # E2E tests

# Database
bun run db:migrate       # Run migrations
bun run db:generate      # Generate Kysely types

# Go Services
cd services/orchestrator && go run main.go
cd services/whatsapp && go run main.go
```

### Environment Variables

```bash
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:4447/whatsapp_web

# NATS
NATS_URL=nats://localhost:4448

# Meilisearch
MEILI_URL=http://localhost:4449
MEILI_MASTER_KEY=development_master_key

# S3/MinIO
S3_ENDPOINT=http://localhost:4450
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=whatsapp-media

# JWT
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_IN=7d

# Email (Resend)
RESEND_API_KEY=re_xxxxx
```

---

## Related Documentation

- [WebSocket Flow](websocket-flow.md) - Complete WebSocket architecture
- [WhatsApp Connection Flow](whatsapp-connection-flow.md) - QR code pairing process
- [WhatsApp Sync Flow](whatsapp-sync-flow.md) - Initial message synchronization
- [Typing Indicator Flow](typing-indicator-flow.md) - Real-time typing indicators
