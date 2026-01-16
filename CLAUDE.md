# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Multi-tenant WhatsApp Web collaborative business messaging platform. Enables businesses to manage WhatsApp communications with team collaboration, contact assignment, and audit logging.

## Commands

```bash
# Development (all apps)
bun run dev

# Build
bun run build

# Lint & Format
bun run lint
bun run format

# Tests
bun run test                                    # All tests
cd apps/api && bun test                         # Backend unit tests
cd apps/api && bun test src/__tests__/services/auth.service.test.ts  # Single test file
cd apps/web && bunx playwright test             # E2E tests
cd apps/web && bunx playwright test auth.spec.ts  # Single E2E spec

# Database
bun run db:migrate    # Run migrations
bun run db:generate   # Generate Kysely types from schema

# Go Services (from respective directories)
cd services/orchestrator && go run main.go
cd services/whatsapp && go run main.go
```

## Architecture

### Monorepo Structure

- `apps/api` - Hono + Bun backend API (port 4445)
- `apps/web` - React + Vite frontend (port 4444)
- `apps/marketing` - Astro marketing site (port 4446)
- `packages/database` - Kysely database client & migrations
- `packages/shared` - Shared TypeScript types
- `packages/ui` - Shared React components
- `services/orchestrator` - Go service managing WhatsApp worker lifecycle
- `services/whatsapp` - Go WhatsApp client using whatsmeow (one process per account)

### Multi-Tenancy

Schema-per-tenant isolation in PostgreSQL. Each company gets `tenant_{company_id}` schema. Public schema holds cross-tenant data (users, companies, invitations).

### Communication Flow

```
Browser <--WebSocket/REST--> Hono API <--NATS JetStream--> Go Services <--whatsmeow--> WhatsApp
```

### Key Middleware Chain (API)

1. CORS (allows X-Company-ID header)
2. Logger
3. Auth middleware (JWT validation)
4. Tenant middleware (schema switching based on X-Company-ID)

## Shared Types

The `packages/shared` package is the **single source of truth** for TypeScript enums and types. The database package re-exports these types for convenience.

### Core Enums

```typescript
import {
  MessageType, // "text" | "image" | "video" | "audio" | "document" | "sticker" | "location" | "contact" | "reaction" | "template"
  MessageStatus, // "pending" | "sent" | "delivered" | "read" | "failed"
  CompanyStatus, // "active" | "suspended" | "deleted"
  CompanyMemberRole, // "owner" | "admin" | "member"
} from "@whatsapp-web/shared";

// Also available from database package (re-exports from shared)
import { MessageType, CompanyMemberRole } from "@whatsapp-web/database";
```

### Anti-Patterns (Avoid)

```typescript
// ❌ WRONG - Defining local type unions
type MessageType = "text" | "image" | "video";

// ✅ CORRECT - Import from shared package
import { MessageType } from "@whatsapp-web/shared";
```

## Tech Stack

| Layer       | Technology                                                      |
| ----------- | --------------------------------------------------------------- |
| Frontend    | React 19, Vite, TanStack Query, Zustand, Tailwind v4, shadcn/ui |
| Backend     | Hono, Bun, Kysely, PostgreSQL 16                                |
| Go Services | Go 1.24, whatsmeow, NATS                                        |
| Search      | Meilisearch                                                     |
| Queue       | NATS JetStream                                                  |
| Storage     | Cloudflare R2 (MinIO for dev)                                   |
| Email       | Resend                                                          |

## Database

Migrations in `/packages/database/src/migrations/`. After schema changes:

```bash
bun run db:migrate
bun run db:generate
```

## Testing

### Backend (Bun test runner)

Tests in `apps/api/src/__tests__/`. Uses `mock.module()` for mocking - paths must be relative to test file (e.g., `../../services/tenant.service.js`).

### E2E (Playwright)

Tests in `apps/web/e2e/tests/`. Page Object Model pattern in `e2e/pages/`. Auth fixtures in `e2e/fixtures/`.

## Environment Setup

1. Copy `.env.example` to `.env`
2. `docker-compose up -d` (PostgreSQL:4447, NATS:4448, Meilisearch:4449, MinIO:4450)
3. `bun install`
4. `bun run db:migrate`
5. `bun run dev`

## Claude Code Session

Before starting a Claude Code session, ensure `dev-start.sh` is running. If it's not running, start it in the background:

```bash
./dev-start.sh &
```

## API Routes

All prefixed with `/api`:

- `/auth` - Authentication (login, register, refresh)
- `/companies` - Company management
- `/contacts` - Contact CRUD
- `/messages` - Message history, send
- `/whatsapp` - Connection status, device linking
- `/tags`, `/audit`, `/analytics`, `/export`, `/search`, `/ws`

## Frontend Routes

Protected routes redirect to `/login` if unauthenticated, to `/company-setup` if no company.

- `/chat`, `/chat/:contactId` - Main chat interface
- `/team` - Team management
- `/settings` - User settings
- `/audit` - Audit log
- `/invite/:token` - Accept invitation

## Code Splitting & Lazy Loading

The frontend uses route-based code splitting for optimal bundle sizes. Each page is lazy-loaded as a separate chunk.

### Adding New Routes

When adding a new page route:

```tsx
// In App.tsx - use React.lazy() with Suspense
const NewPage = lazy(() => import("./pages/NewPage").then(m => ({ default: m.NewPage })))

<Route
  path="/new-page"
  element={
    <ProtectedRoute>
      <Suspense fallback={<PageSkeleton variant="default" />}>
        <NewPage />
      </Suspense>
    </ProtectedRoute>
  }
/>
```

### PageSkeleton Variants

Use the appropriate skeleton variant for loading states:

```tsx
import { PageSkeleton } from "@/components/ui"

// Available variants: "default" | "chat" | "settings" | "dashboard" | "auth" | "team"
<Suspense fallback={<PageSkeleton variant="chat" />}>
  <ChatPage />
</Suspense>
```

### Route Preloading

Preload routes on hover for instant navigation:

```tsx
import { preloadRoute } from "@/lib/route-preload"

// In navigation components
<Link
  to="/settings"
  onMouseEnter={() => preloadRoute("settings")}
  onFocus={() => preloadRoute("settings")}
>
  Settings
</Link>

// Available route names: login, register, forgotPassword, companySetup, chat, team, settings, audit, dashboard, acceptInvitation
```

### Data Prefetching

Prefetch query data on hover for faster content loading:

```tsx
import { usePrefetchContact } from "@/hooks/usePrefetch"

function ChatListItem({ chat, onClick }) {
  const prefetchContact = usePrefetchContact()

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => prefetchContact(chat.id)}
    >
      {chat.contact.name}
    </button>
  )
}
```

### Bundle Analysis

Analyze bundle composition with:

```bash
cd apps/web && bun run analyze
```

This generates `stats.html` showing chunk sizes and dependencies.

### Vite Manual Chunks

The build splits vendor libraries into separate chunks (configured in `vite.config.ts`):

- `react-vendor` - React core
- `router` - React Router
- `tanstack` - TanStack Query & Virtual
- `form` - React Hook Form + Zod
- `radix-ui` - Radix primitives
- `zustand` - State management
- `motion` - Animation library
- `i18n` - Internationalization

### Anti-Patterns (Avoid)

```tsx
// ❌ WRONG - Import from pages barrel (breaks code splitting)
import { ChatPage, SettingsPage } from "./pages"

// ✅ CORRECT - Use lazy imports for routes
const ChatPage = lazy(() => import("./pages/ChatPage").then(m => ({ default: m.ChatPage })))

// ❌ WRONG - No Suspense boundary
<Route path="/chat" element={<ChatPage />} />

// ✅ CORRECT - Wrap in Suspense with skeleton
<Route path="/chat" element={
  <Suspense fallback={<PageSkeleton variant="chat" />}>
    <ChatPage />
  </Suspense>
} />
```

## Code Style

Biome handles linting and formatting. Single quotes, no semicolons, 2-space indent. Run `bun run format` before commits.

## Go Services

Located in `/services/`. Each has its own `go.mod`. Use `golangci-lint` for linting (config in `.golangci.yml`).

## Database Schema Fixes

When fixing database schema issues (missing columns, wrong types, etc.):

**DO NOT** do quick fixes like:

- Running `ALTER TABLE` directly on the database
- Updating functions via `psql` commands
- Patches that work "now" but don't persist in version control

**DO** fix properly:

1. Find the root cause in migration files
2. Update the migration file at the source
3. Check if later migrations overwrite earlier ones (e.g., `setup_tenant_schema` function)
4. Ensure fresh database setups work correctly
5. Test with `bun run db:migrate` on a clean database

### Tenant Schema Migrations

For multi-tenant schema changes, use the migration helpers in `packages/database/src/migrations/migration-helpers.ts`:

```typescript
import {
  addColumnToAllTenants,
  executeOnAllTenants,
} from "../migrations/migration-helpers.js";

// ✅ CORRECT - Apply changes to ALL existing tenant schemas
export async function up(db: Kysely<unknown>): Promise<void> {
  // Add a column to all tenant schemas
  await addColumnToAllTenants(db, "messages", "new_column", "VARCHAR(100)");

  // Or use the generic helper for custom operations
  await executeOnAllTenants(db, async (schemaName) => {
    await sql`ALTER TABLE ${sql.raw(`"${schemaName}".messages`)} ADD COLUMN ...`.execute(
      db
    );
  });

  // IMPORTANT: Also update migration 015's setup_tenant_schema function
  // so NEW tenants created after this migration get the column too
}
```

**Common pitfall**: The `setup_tenant_schema` function was historically overwritten in multiple migrations (009-014), causing inconsistent schemas. Migration 015 established this function as the single source of truth. For new columns/tables, update ONLY migration 015's function definition.

## Dark Mode

The application supports light, dark, and system-preference themes. The theme system uses CSS class-based toggling with Tailwind v4's `@custom-variant`.

### Using Theme in Components

```typescript
import { useTheme } from "@/contexts/theme-context";

function MyComponent() {
  const { theme, resolvedTheme, setTheme, toggleTheme } = useTheme();

  // theme: 'light' | 'dark' | 'system'
  // resolvedTheme: 'light' | 'dark' (actual applied theme)
  // setTheme: set to specific theme
  // toggleTheme: cycle through light → dark → system
}
```

### Semantic Color Reference

Use these semantic colors for dark mode styling (defined in `apps/web/src/index.css`):

| Color                 | Value   | Usage                                  |
| --------------------- | ------- | -------------------------------------- |
| `dark-primary`        | #111B21 | Main background (message thread)       |
| `dark-secondary`      | #1F2C33 | Sidebar, headers, cards                |
| `dark-elevated`       | #202C33 | Elevated surfaces (bubbles, dropdowns) |
| `dark-tertiary`       | #2A3942 | Selected/hover states                  |
| `dark-border`         | #2F3B43 | Borders and dividers                   |
| `dark-text-primary`   | #E9EDEF | Primary text                           |
| `dark-text-secondary` | #8696A0 | Secondary text                         |
| `dark-text-tertiary`  | #667781 | Muted text, placeholders               |

### Adding Dark Mode to New Components

1. Add `dark:` variants alongside existing light mode classes:

```tsx
// Before
<div className="bg-white text-gray-900 border-gray-200">

// After
<div className="bg-white dark:bg-dark-elevated text-gray-900 dark:text-dark-text-primary border-gray-200 dark:border-dark-border">
```

2. Common patterns:
   - Backgrounds: `bg-gray-50 dark:bg-dark-secondary`
   - Text: `text-gray-700 dark:text-dark-text-primary`
   - Muted text: `text-gray-500 dark:text-dark-text-secondary`
   - Borders: `border-gray-200 dark:border-dark-border`
   - Hover states: `hover:bg-gray-100 dark:hover:bg-dark-tertiary`

3. Brand colors (`whatsapp-green`, `whatsapp-teal-green`) work in both themes - do not modify.

4. Theme persistence: Theme is stored in localStorage (`whatsapp-web-theme`). The FOUC prevention script in `index.html` applies the theme before React renders.

## Error Handling

### React Error Boundaries

The application uses React Error Boundaries to catch and handle component errors gracefully:

```tsx
// Location: apps/web/src/components/error-boundary.tsx

// The ErrorBoundary wraps the entire app in main.tsx
// Catches all React component errors and displays a user-friendly fallback

// For custom error handling in specific areas:
import { ErrorBoundary } from "@/components/error-boundary";

<ErrorBoundary
  fallback={<CustomFallback />}
  onError={(error, errorInfo) => logToService(error)}
>
  <RiskyComponent />
</ErrorBoundary>;
```

Features:

- User-friendly error screen with recovery options
- "Go to Home" and "Refresh Page" buttons
- Development-only error details (component stack trace)
- Dark mode support

### Form Validation

The application uses react-hook-form with Zod for form validation:

```tsx
// Zod schemas are in: apps/web/src/lib/schemas/
import { loginSchema, registerSchema, forgotPasswordSchema } from '@/lib/schemas'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { FormField } from '@/components/ui/form-field'

const {
  register,
  handleSubmit,
  formState: { errors },
} = useForm({
  resolver: zodResolver(loginSchema),
})

// Use FormField for consistent form inputs with error display
<FormField
  label="Email"
  error={errors.email?.message}
  {...register('email')}
/>
```

Existing schemas:

- `loginSchema` - Email and password validation
- `registerSchema` - Name, email, password with confirmation
- `forgotPasswordSchema` - Email validation
- `addContactSchema` - Phone number validation
- `companySetupSchema` - Company name validation

## Email System

The backend uses Resend for transactional emails:

```typescript
// Location: apps/api/src/lib/email.ts

// Available email functions:
import {
  sendVerificationEmail, // Account verification
  sendPasswordResetEmail, // Password reset
  sendInvitationEmail, // Team invitation
} from "@/lib/email";

// In development mode, emails are logged instead of sent
// Set RESEND_API_KEY in .env for production
```

Email templates are HTML with inline styles for cross-client compatibility.

## Date/Time Handling

All datetime operations use **dayjs** through a centralized module in `@whatsapp-web/shared`. **Never use native JavaScript `Date` directly.**

### Import Pattern

```typescript
import {
  // Core utilities
  now, // Current time in UTC (returns dayjs)
  nowMs, // Current timestamp in milliseconds
  toDbDate, // Date object for database storage
  toISOString, // ISO 8601 string format
  toDate, // Convert to native Date object
  parseDate, // Parse any input to dayjs

  // Display formatting
  formatMessageTime, // "14:30" - for message bubbles
  formatChatListTime, // "Yesterday" / "Mon" / "Jan 5" - for chat list
  formatDateSeparator, // "Today" / "Yesterday" / "Monday, January 15"
  formatLastSeen, // "online" / "last seen 2 hours ago"
  formatRelativeTime, // "5 minutes ago"
  formatStatusTime, // "5m ago" / "2h ago" (compact)
  formatAuditTime, // "Jan 5, 2024 14:30:45"

  // Date manipulation
  startOfDay, // Start of day in UTC
  endOfDay, // End of day in UTC
  subtractDays, // Subtract N days from date
  addDays, // Add N days to date
  getDateRange, // Get { start, end } for '7d' | '30d' | '90d'

  // Checks
  isToday, // Check if date is today
  isYesterday, // Check if date is yesterday

  // Direct dayjs access (only when needed)
  dayjs,
} from "@whatsapp-web/shared";
```

### UTC Convention

- **Storage/Processing**: Always use UTC. Functions like `now()`, `toDbDate()`, `parseDate()` work in UTC by default.
- **Display**: Use display functions like `formatMessageTime()`, `formatChatListTime()` which automatically convert to local time.
- **API Responses**: Return ISO strings in UTC using `toISOString()`.

### Common Patterns

```typescript
// Current time
const timestamp = nowMs(); // Replaces Date.now()
const dbDate = toDbDate(); // For Kysely inserts: created_at: toDbDate()

// Date math
const thirtyDaysAgo = subtractDays(dayjs.utc(), 30);
const range = getDateRange("30d"); // { start, end }

// Display formatting (automatically uses local time)
formatMessageTime(message.createdAt); // "14:30"
formatChatListTime(chat.lastMessageAt); // "Yesterday" / "Mon" / "Jan 5"
formatLastSeen(contact.lastSeen, isOnline); // "last seen 2 hours ago"
formatRelativeTime(notification.createdAt); // "5 minutes ago"

// ISO string for APIs
const isoString = toISOString(date); // "2024-01-15T14:30:00.000Z"
```

### Anti-Patterns (Do NOT Use)

```typescript
// WRONG                              // CORRECT
new Date()                            // now() or toDbDate()
Date.now()                            // nowMs()
date.setDate(date.getDate() - 7)      // subtractDays(date, 7)
date.toLocaleTimeString()             // formatMessageTime()
date.toLocaleDateString()             // formatChatListTime()
new Date(Date.now() - 30 * 24 * ...)  // subtractDays(dayjs.utc(), 30)
```

### Adding New Date Utilities

If you need date functionality not covered by existing helpers:

1. Add the function to `packages/shared/src/date.ts`
2. Export it from `packages/shared/src/index.ts`
3. Document it in this section

## Phone Number Utilities

Phone number utilities are available in `@whatsapp-web/shared` for formatting and parsing WhatsApp phone numbers:

```typescript
import {
  formatPhoneNumber, // Format with + prefix: "1234567890" → "+1234567890"
  formatPhoneNumberWithGroups, // Group digits: "12345678901" → "+1 234 567 8901"
  parsePhoneFromJid, // Extract from JID: "1234567890@s.whatsapp.net" → "1234567890"
  isValidPhoneNumber, // Basic validation
} from "@whatsapp-web/shared";

// Common usage: displaying participant phone numbers
const phoneNumber = parsePhoneFromJid(participant.jid);
const displayName = formatPhoneNumber(phoneNumber);
```

### Anti-Patterns (Avoid)

```typescript
// ❌ WRONG - Local phone formatting
const formatPhone = (jid: string) => "+" + jid.split("@")[0];

// ✅ CORRECT - Use shared utilities
import { formatPhoneNumber, parsePhoneFromJid } from "@whatsapp-web/shared";
formatPhoneNumber(parsePhoneFromJid(jid));
```

## Backend Route Helpers

The backend provides utility helpers in `apps/api/src/lib/route-helpers.ts` for common route patterns.

### Pagination Helpers

```typescript
import {
  extractPaginationParams,
  createPaginationMeta,
} from "@/lib/route-helpers.js";

// Extract pagination from query params
const { limit, offset } = extractPaginationParams(c.req.query());
// Defaults: limit=20, offset=0
// Custom defaults: extractPaginationParams(query, { defaultLimit: 50 })

// Create pagination metadata for responses
const meta = createPaginationMeta(totalCount, limit, offset);
// Returns: { total, limit, offset, hasMore }
```

### Entity Existence Helper

Use `requireEntity<T>()` to check if an entity exists and throw a 404 error if not:

```typescript
import { requireEntity } from "@/lib/route-helpers.js";

// Before (verbose):
const contact = await tenantDb
  .selectFrom("contacts")
  .where("id", "=", contactId)
  .executeTakeFirst();
if (!contact) {
  return notFound(c, "Contact");
}
// contact is possibly undefined here

// After (concise):
const contact = requireEntity(
  await tenantDb
    .selectFrom("contacts")
    .where("id", "=", contactId)
    .executeTakeFirst(),
  "Contact"
);
// contact is guaranteed to exist here, or NotFoundError is thrown
```

The helper throws `NotFoundError` which is caught by the global error handler in `app.ts` and returns a proper 404 response.

## Backend Error Handling

The backend uses a centralized error handling pattern with custom error classes that extend `AppError`. All errors are caught by the global error handler in `apps/api/src/app.ts`.

### Error Class Hierarchy

```typescript
// Base error class
export class AppError extends Error {
  constructor(message: string, statusCode: number = 500, details?: unknown);
}

// HTTP-specific errors
export class ValidationError extends AppError {}      // 400
export class UnauthorizedError extends AppError {}    // 401
export class ForbiddenError extends AppError {}       // 403
export class NotFoundError extends AppError {}        // 404
export class ConflictError extends AppError {}        // 409
export class TooManyRequestsError extends AppError {} // 429
export class ServiceUnavailableError extends AppError {} // 503

// Domain-specific errors (extend the above)
export class CompanyNotFoundError extends NotFoundError {}
export class InvitationExpiredError extends ValidationError {}
export class AuthError extends AppError { code: string }
```

### Usage in Routes

**Throw errors and let the global handler catch them:**

```typescript
import { NotFoundError, ForbiddenError } from "@/lib/errors.js";

app.get("/:id", async (c) => {
  const item = await service.getItem(id);
  if (!item) {
    throw new NotFoundError("Item");
  }
  if (!canAccess(item)) {
    throw new ForbiddenError("You cannot access this item");
  }
  return successData(c, item);
});
```

### Anti-Patterns (Avoid)

```typescript
// ❌ WRONG - Manual try/catch with HTTPException
try {
  const item = await service.getItem(id);
  return successData(c, item);
} catch (error) {
  if (error instanceof ItemNotFoundError) {
    throw new HTTPException(404, { message: error.message });
  }
  throw error;
}

// ✅ CORRECT - Let errors bubble up to global handler
const item = await service.getItem(id); // Throws NotFoundError if not found
return successData(c, item);
```

### Error Response Formats

The global error handler returns consistent error responses:

```json
// Standard error
{ "error": "Resource not found" }

// Validation error (from Zod)
{ "error": "Validation Error", "details": [{ "field": "email", "message": "Invalid email" }] }

// Auth error (includes code for frontend handling)
{ "error": "INVALID_CREDENTIALS", "message": "Invalid email or password" }

// Error with details
{ "error": "Rate limit exceeded", "details": { "retryAfter": 60 } }
```

## Backend Type Safety with AppType

The backend exports `AppType` for type-safe RPC client usage with Hono Client.

### Export Location

```typescript
// apps/api/src/routes/index.ts
export type AppType = typeof routes;

// Also re-exported from main entry
// apps/api/src/index.ts
export type { AppType } from './routes/index.js'
```

### Usage with Hono Client

```typescript
// In frontend or other TypeScript client
import { hc } from 'hono/client'
import type { AppType } from '@whatsapp-web/api'

const client = hc<AppType>('http://localhost:4445/api')

// Type-safe API calls
const response = await client.contacts.$get()
```

**Note:** Due to the use of `routes.route()` for modular organization, full type inference for nested routes is limited. For complete type inference, individual route files would need to use method chaining.

## Backend Response Helpers

Always use response helpers from `apps/api/src/lib/response.ts` for consistent API responses.

### Usage

```typescript
import {
  successData, // Single entity: { data: T }
  successPaginated, // Paginated list: { data: T[], pagination: PaginationMeta }
  created, // Created entity (201): { data: T }
  successMessage, // Success message: { message: string }
  successWithMessage, // Data with message: { data: T, message: string }
  noContent, // No content (204)
  notFound, // Not found (404)
  badRequest, // Bad request (400)
} from "@/lib/response.js";

// Examples:
return successData(c, user);
return successPaginated(c, contacts, paginationMeta);
return created(c, newContact);
return successMessage(c, "Contact deleted successfully");
return notFound(c, "Contact");
```

### Anti-Patterns (Avoid)

```typescript
// ❌ WRONG - Raw c.json() with inconsistent formats
return c.json({ success: true, data: user });
return c.json({ user });
return c.json({ message: "OK", status: 200 });

// ✅ CORRECT - Use response helpers
return successData(c, user);
return successMessage(c, "OK");
```

### Intentional Exceptions

Some routes use raw `c.json()` intentionally for backward compatibility or specific requirements:

1. **Health endpoints** (`/routes/health.ts`): Infrastructure endpoints for Kubernetes/Docker probes. Use simple JSON format expected by monitoring tools.

2. **WhatsApp routes** (`/routes/whatsapp/*`): Use `{ success: true, data }` pattern for backward compatibility with frontend WebSocket handlers. This is documented technical debt.

3. **Search endpoints** (`/routes/search.ts`): Include `query` field at top level for debugging. Format: `{ query, data, pagination }`.

4. **Export endpoints** (`/routes/export.ts`): Use custom pagination format (`count` instead of `total`) for export consumers.

### WhatsApp Routes Technical Debt

The following routes use `{ success: true, data }` pattern instead of standard response helpers:

- `routes/whatsapp/connections.ts`
- `routes/whatsapp/legacy.ts`
- `routes/whatsapp/status.ts`

**Reason:** Backward compatibility with frontend WebSocket handlers and existing integrations.

**Fix required:** Coordinate with frontend team to update response parsing before migrating these routes. This should be done as a separate task with proper testing.

## Backend Validation Schemas

Validation schemas are centralized in `apps/api/src/lib/schemas/`. Use Zod with `@hono/zod-validator` for request validation.

### Organization

```
apps/api/src/lib/schemas/
├── index.ts           # Barrel exports
├── auth.ts            # Register, login, verify-email, password reset, refresh
├── contact.ts         # Create, update, list query, notes, assignment, import, tags
├── message.ts         # Send, forward, list query, reactions, batch operations
├── tag.ts             # Create, update, list query
├── company.ts         # Create, update, member roles, invitations, permissions
├── conversation.ts    # List messages query, send message, resolve, analytics
├── group.ts           # List query, update, update settings
├── notification.ts    # Preferences, mute, list query
├── quick-replies.ts   # Create, update, list query
├── whatsapp.ts        # Message sending schemas
└── [domain].ts        # Add new domain schemas here
```

### Usage Pattern

**ALWAYS use `zValidator` from `@hono/zod-validator` for request validation:**

```typescript
// In apps/api/src/lib/schemas/quick-replies.ts
import { z } from "zod";

export const createQuickReplySchema = z.object({
  shortcut: z.string().min(1).max(50).regex(/^[a-zA-Z0-9_-]+$/),
  title: z.string().min(1).max(200),
  content: z.string().min(1),
});

export type CreateQuickReplyInput = z.infer<typeof createQuickReplySchema>;

// In route file - use zValidator in the route chain
import { createQuickReplySchema } from "@/lib/schemas/index.js";
import { zValidator } from "@hono/zod-validator";

// JSON body validation
app.post("/", zValidator("json", createQuickReplySchema), async (c) => {
  const input = c.req.valid("json");
  // input is typed as CreateQuickReplyInput
});

// Query parameter validation
app.get("/", zValidator("query", listQuerySchema), async (c) => {
  const { limit, offset } = c.req.valid("query");
});
```

### Anti-Patterns (Avoid)

```typescript
// ❌ WRONG - Manual safeParse validation
const body = await c.req.json();
const result = schema.safeParse(body);
if (!result.success) {
  return c.json({ error: result.error }, 400);
}

// ✅ CORRECT - Use zValidator
app.post("/", zValidator("json", schema), async (c) => {
  const data = c.req.valid("json"); // Validated and typed
});
```

### Error Response Format

Zod validation errors are automatically formatted by the global error handler in `app.ts`:

```json
{
  "error": "Validation Error",
  "details": [
    { "field": "email", "message": "Invalid email format" },
    { "field": "password", "message": "String must contain at least 8 character(s)" }
  ]
}
```

## Frontend API Client

### FormData Upload Utility

For file uploads with authentication, use `fetchFormDataWithAuth()` from `apps/web/src/lib/api/client.ts`:

```typescript
import { fetchFormDataWithAuth } from "@/lib/api/client";

// Upload a file with automatic auth headers
const formData = new FormData();
formData.append("file", file);

const result = await fetchFormDataWithAuth<UploadResponse>("/api/upload", {
  method: "POST",
  body: formData,
});
```

This utility:

- Automatically adds the access token header
- Adds the company ID header
- Handles token refresh on 401 errors
- Does NOT set Content-Type (lets browser set multipart boundary)

### Anti-Patterns (Avoid)

```typescript
// ❌ WRONG - Manual FormData auth handling
const response = await fetch("/api/upload", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${accessToken}`,
    "X-Company-ID": companyId,
    // Don't set Content-Type for FormData!
  },
  body: formData,
});

// ✅ CORRECT - Use the utility
const result = await fetchFormDataWithAuth("/api/upload", { body: formData });
```

## Frontend Async Data Handling

### useAsyncData Hook

The `useAsyncData<T>()` hook wraps TanStack Query results with built-in state helpers and a `renderState()` function for cleaner component code.

```typescript
import { useAsyncData, combineAsyncData } from '@/hooks'

// Basic usage - wrap any TanStack Query result
const { data, isLoading, isError, isEmpty, hasData, renderState } = useAsyncData(useUser(userId))

// Use renderState() helper for declarative rendering
return renderState({
  loading: () => <Skeleton />,
  error: (error) => <ErrorMessage error={error} />,
  empty: () => <EmptyState />,
  success: (user) => <UserProfile user={user} />,
})

// Or check states manually
if (isLoading) return <Spinner />
if (isError) return <Error />
if (isEmpty) return <Empty />
if (hasData) return <Content data={data} />

// Combine multiple async states
const userData = useAsyncData(useUser(userId))
const postsData = useAsyncData(usePosts(userId))
const combined = combineAsyncData([userData, postsData])

if (combined.isLoading) return <Spinner />
if (combined.allHaveData) return <UserWithPosts />
```

**State helpers**:

- `isLoading` - Query is in loading state
- `isError` - Query has errored
- `isEmpty` - Data is null, undefined, or empty array
- `hasData` - Data is available and not empty
- `renderState()` - Declarative render helper with default renderers

### Anti-Patterns (Avoid)

```typescript
// ❌ WRONG - Repetitive state checks in each component
const { data, isLoading, isError } = useQuery(...)
if (isLoading) return <Loading />
if (isError) return <Error />
if (!data || data.length === 0) return <Empty />
return <Content data={data} />

// ✅ CORRECT - Use useAsyncData with renderState()
const asyncData = useAsyncData(useQuery(...))
return asyncData.renderState({
  success: (data) => <Content data={data} />,
})
```

## Frontend UI Hooks

The frontend provides reusable UI hooks in `apps/web/src/hooks/ui/` for common interaction patterns.

### useClickOutside

Detect clicks outside a referenced element:

```typescript
import { useClickOutside } from '@/hooks/ui'

function Dropdown({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)

  // Close when clicking outside
  useClickOutside(ref, onClose)

  // Only listen when open
  useClickOutside(ref, onClose, { enabled: isOpen })

  // Use different event type
  useClickOutside(ref, onClose, { eventType: 'mouseup' })

  return <div ref={ref}>Content</div>
}
```

### useTextareaAutoResize

Auto-resize textarea based on content:

```typescript
import { useTextareaAutoResize } from '@/hooks/ui'

function MessageInput() {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [value, setValue] = useState('')

  const { resize, reset } = useTextareaAutoResize(ref, {
    maxHeight: 150,  // Max height before scrolling
    minHeight: 40,   // Minimum height
    deps: [value],   // Deps that trigger resize
  })

  const handleSend = () => {
    sendMessage(value)
    setValue('')
    reset() // Reset height after clearing
  }

  return <textarea ref={ref} value={value} onChange={(e) => setValue(e.target.value)} />
}
```

### useRelativePosition

Calculate position relative to a container (for context menus, tooltips):

```typescript
import { useRelativePosition } from '@/hooks/ui'

function MessageBubble() {
  const ref = useRef<HTMLDivElement>(null)
  const { position, calculateFromMouseEvent, calculateReactionPickerPosition } = useRelativePosition(ref)

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    calculateFromMouseEvent(e) // Position at mouse cursor
    setShowMenu(true)
  }

  // Or position reaction picker relative to element
  calculateReactionPickerPosition(isOwn, -50) // isOwn affects horizontal placement

  return (
    <div ref={ref} onContextMenu={handleContextMenu}>
      {showMenu && <Menu style={{ left: position.x, top: position.y }} />}
    </div>
  )
}
```

### usePopoverPosition

Calculate popover position with viewport boundary awareness:

```typescript
import { usePopoverPosition } from '@/hooks/ui'

function Tooltip({ content }: { content: string }) {
  const ref = useRef<HTMLButtonElement>(null)
  const { x, y, placement, calculate } = usePopoverPosition(ref, {
    placement: 'top',     // Preferred placement
    gap: 8,               // Gap between trigger and popover
    viewportPadding: 8,   // Padding from viewport edges
  })

  // Call calculate() when showing popover with popover dimensions
  useEffect(() => {
    if (visible) calculate(200, 50) // popoverWidth, popoverHeight
  }, [visible])

  // placement will flip if not enough space (e.g., 'top' -> 'bottom')
  return <div style={{ left: x, top: y }}>{content}</div>
}
```

## Frontend Shared UI Components

Shared UI components are in `apps/web/src/components/ui/`:

### LoadingSpinner

A reusable loading indicator with configurable sizes:

```typescript
import { LoadingSpinner } from '@/components/ui/loading-spinner'

// Available sizes: xs, sm, md (default), lg
<LoadingSpinner />                          // Medium (h-8 w-8)
<LoadingSpinner size="sm" />                // Small (h-5 w-5)
<LoadingSpinner size="lg" />                // Large (h-12 w-12)
<LoadingSpinner className="text-blue-500" /> // Custom color
```

### ConfirmationDialog

A reusable confirmation dialog for destructive or important actions:

```typescript
import { ConfirmationDialog } from '@/components/ui'

<ConfirmationDialog
  open={isOpen}
  onOpenChange={setIsOpen}
  title="Delete Contact"
  description="Are you sure you want to delete this contact? This action cannot be undone."
  confirmLabel="Delete"
  cancelLabel="Cancel"
  isDestructive        // Red confirm button
  isLoading={isPending} // Shows spinner in confirm button
  onConfirm={handleDelete}
  onCancel={() => setIsOpen(false)}
/>
```

### Tabs

A reusable tabs component with controlled and uncontrolled modes:

```typescript
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui'

// Uncontrolled mode
<Tabs defaultValue="members">
  <TabsList>
    <TabsTrigger value="members">Members</TabsTrigger>
    <TabsTrigger value="invitations">Invitations</TabsTrigger>
  </TabsList>
  <TabsContent value="members">...</TabsContent>
  <TabsContent value="invitations">...</TabsContent>
</Tabs>

// Controlled mode
<Tabs value={activeTab} onValueChange={setActiveTab}>
  ...
</Tabs>
```

Features:

- Keyboard navigation (Arrow keys, Home/End)
- ARIA-compliant roles
- WhatsApp-style underline indicator
- Dark mode support

### EllipsisMenu

A vertical dots menu for item actions:

```typescript
import { EllipsisMenu } from '@/components/ui'

<EllipsisMenu
  items={[
    { id: 'edit', label: 'Edit', icon: Edit, onClick: handleEdit },
    { id: 'delete', label: 'Delete', icon: Trash2, onClick: handleDelete, destructive: true },
  ]}
  // Optional: controlled mode
  open={isOpen}
  onOpenChange={setIsOpen}
/>
```

Features:

- MoreVertical trigger icon
- Keyboard navigation
- Destructive action styling
- Click outside to close
- Dark mode support

### StepWizard

A multi-step wizard component for guided workflows:

```typescript
import { StepWizard, StepProgress, StepContent, type StepWizardStep } from '@/components/ui'

const STEPS: StepWizardStep[] = [
  { id: 'upload', label: 'Upload' },
  { id: 'preview', label: 'Preview' },
  { id: 'complete', label: 'Done' },
]

function ImportWizard() {
  const [step, setStep] = useState<string>('upload')

  return (
    <StepWizard steps={STEPS} currentStep={step} showProgress>
      <StepContent stepId="upload" currentStep={step}>
        <UploadStep onNext={() => setStep('preview')} />
      </StepContent>
      <StepContent stepId="preview" currentStep={step}>
        <PreviewStep onNext={() => setStep('complete')} />
      </StepContent>
      <StepContent stepId="complete" currentStep={step}>
        <CompleteStep />
      </StepContent>
    </StepWizard>
  )
}

// Use StepProgress standalone for custom layouts
<StepProgress steps={STEPS} currentStepIndex={1} />
```

Features:

- `StepWizard` - wrapper with optional progress indicator
- `StepProgress` - visual progress with completed/current/pending states
- `StepContent` - conditional renderer based on current step
- Dark mode support
- Completed steps show checkmarks

### Anti-Patterns (Avoid)

```typescript
// ❌ WRONG - Local spinner definitions
const Spinner = () => (
  <svg className="animate-spin h-5 w-5">...</svg>
)

// ✅ CORRECT - Use shared component
import { LoadingSpinner } from '@/components/ui/loading-spinner'
<LoadingSpinner size="sm" />
```

## Frontend Hook Organization

Hooks are organized by feature domain in `apps/web/src/hooks/`:

```
hooks/
├── index.ts              # Barrel export for all hooks
├── useAsyncData.tsx      # Async data wrapper utility
├── query.ts              # TanStack Query utilities
├── query-keys.ts         # Query key factories
│
├── ui/                   # UI interaction hooks
│   ├── index.ts          # Barrel export
│   ├── useClickOutside.ts
│   ├── useTextareaAutoResize.ts
│   ├── useElementPosition.ts  # useRelativePosition, usePopoverPosition
│   ├── useViewportBoundedPosition.ts  # useViewportBoundedPosition, useAutoAdjustedPosition
│   ├── useDebounce.ts
│   ├── useMediaQuery.ts
│   ├── useSwipeGesture.ts
│   ├── useKeyboardShortcuts.ts
│   └── useFormState.ts
│
├── notification/         # Notification hooks
│   ├── index.ts          # Barrel export
│   ├── useNotifications.ts
│   └── useNotificationCenter.ts
│
├── analytics/            # Analytics hooks
│   ├── index.ts          # Barrel export
│   └── useAnalytics.ts
│
├── chat/                 # Chat page hooks
│   ├── index.ts          # Barrel export
│   └── useChatPageState.ts  # ChatPage state management
│
├── useChats.ts           # Chat list hooks
├── useContact.ts         # Contact hooks
├── useMessages.ts        # Message hooks
├── useInfiniteMessages.ts # Infinite scroll messages
├── useWebSocket.ts       # WebSocket hooks
└── ...                   # Other feature hooks
```

**Import pattern**:

```typescript
// Import from main barrel (recommended)
import { useClickOutside, useAsyncData, useNotifications } from "@/hooks";

// Or import from feature directory
import { useClickOutside } from "@/hooks/ui";
import { useNotifications } from "@/hooks/notification";
```

## Frontend Composable Props

Reusable Props interface utilities are available in `apps/web/src/types/component-props.ts`:

```typescript
import type {
  WithChildrenProps,
  WithClassNameProps,
  WithLoadingProps,
  WithErrorProps,
  WithOnChangeProps,
  FormInputProps,
  DialogProps,
  CardProps,
  ComposableProps,
  MergeWithHTML,
} from "@/types/component-props";

// Compose interfaces for your components
interface MyButtonProps extends WithClassNameProps, WithLoadingProps {
  label: string;
  onClick: () => void;
}

// Use pre-built compound interfaces
interface MyDialogProps extends DialogProps {
  title: string;
}

// Merge with HTML element props
interface MyInputProps extends MergeWithHTML<
  WithErrorProps,
  HTMLInputElement
> {}

// Pick specific composable props
type MyProps = ComposableProps<"className" | "loading" | "error">;
```

**Available interfaces**:

- Base: `WithChildrenProps`, `WithClassNameProps`, `WithStyleProps`, `WithIdProps`, `WithTestIdProps`
- State: `WithLoadingProps`, `WithErrorProps`, `WithDisabledProps`, `WithSelectedProps`, `WithExpandedProps`
- Handlers: `WithOnChangeProps<T>`, `WithOnClickProps`, `WithOnSubmitProps`, `WithOnCloseProps`
- Compound: `FormInputProps`, `ListItemProps`, `DialogProps`, `ActionButtonProps`, `CardProps`

## Frontend Context Patterns

### Message Actions Context

Message action callbacks (reply, forward, delete, star, react) are provided via `MessageActionsContext` to avoid prop drilling:

```typescript
// In ChatPage.tsx - Provides the context
import { MessageActionsProvider } from '@/contexts'

<MessageActionsProvider value={{ onReply, onForward, onDelete, onStar, onReact }}>
  <MessageThread />
</MessageActionsProvider>

// In MessageBubble.tsx - Consumes the context
import { useMessageActions } from '@/contexts'

function MessageBubble({ message }) {
  const { onReply, onDelete, onStar } = useMessageActions()

  return (
    <button onClick={() => onReply(message)}>Reply</button>
  )
}
```

**Note**: `onRetry` is NOT in the context - it's passed as a prop because it's local to `MessageThread` and uses local state for retry status.

## Go Services Shared Module

Go services share common utilities through `services/shared/`. Both `orchestrator` and `whatsapp` services import from this module.

### Config Utilities

```go
import "github.com/ygncode-lab/whatsapp-web/services/shared/config"

// Get environment variables with defaults
natsURL := config.GetEnv("NATS_URL", "nats://localhost:4448")
timeout := config.GetDurationEnv("TIMEOUT", 30*time.Second)
port := config.GetIntEnv("PORT", 8080)
debug := config.GetBoolEnv("DEBUG", false)

// Required env var (panics if not set)
dbURL := config.GetEnvRequired("DATABASE_URL")
```

### NATS Connection

```go
import sharednats "github.com/ygncode-lab/whatsapp-web/services/shared/nats"

// Create a connection
conn, err := sharednats.NewConnection(ctx, sharednats.ConnectionConfig{
    URL:  natsURL,
    Name: "my-service",
})
if err != nil {
    log.Fatal(err)
}
defer conn.Close()

// Access JetStream
js := conn.JetStream()

// Ensure streams exist
err = sharednats.EnsureStream(js, sharednats.DefaultEventsStreamConfig())
```

### NATS Event Types

All event types are defined in `services/shared/nats/events.go`:

```go
import sharednats "github.com/ygncode-lab/whatsapp-web/services/shared/nats"

// Event payload types
event := sharednats.WhatsAppEvent{
    Type:         sharednats.EventTypeMessage,
    CompanyID:    companyID,
    ConnectionID: connectionID,
    Payload: sharednats.MessagePayload{
        MessageID:   msg.ID,
        From:        msg.From,
        Content:     msg.Content,
        MessageType: msg.Type,
    },
    Timestamp: time.Now().Format(time.RFC3339),
}

// Command types
cmd := sharednats.SpawnWorkerCommand{
    Type:         sharednats.CommandSpawn,
    CompanyID:    companyID,
    ConnectionID: connectionID,
}

// Status constants
if status == sharednats.StatusConnected {
    // ...
}
```

### Module Setup

Both services use a `replace` directive in their `go.mod` for local development:

```go
// In services/orchestrator/go.mod and services/whatsapp/go.mod
require github.com/ygncode-lab/whatsapp-web/services/shared v0.0.0

replace github.com/ygncode-lab/whatsapp-web/services/shared => ../shared
```

### Building Go Services

```bash
# Build all services
cd services/shared && go build ./...
cd services/orchestrator && go build ./...
cd services/whatsapp && go build ./...
```
