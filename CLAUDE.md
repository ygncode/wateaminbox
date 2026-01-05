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

- `apps/api` - Hono + Bun backend API (port 3001)
- `apps/web` - React + Vite frontend (port 5173)
- `apps/marketing` - Astro marketing site (port 4321)
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

## Tech Stack

| Layer       | Technology                                                      |
| ----------- | --------------------------------------------------------------- |
| Frontend    | React 18, Vite, TanStack Query, Zustand, Tailwind v4, shadcn/ui |
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
2. `docker-compose up -d` (PostgreSQL:5433, NATS:4222, Meilisearch:7700, MinIO:9000)
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

## Code Style

Biome handles linting and formatting. Single quotes, no semicolons, 2-space indent. Run `bun run format` before commits.

## Go Services

Located in `/services/`. Each has its own `go.mod`. Use `golangci-lint` for linting (config in `.golangci.yml`).

## Codebase Exploration

When you need to explore or understand the codebase, use the `check-code-base` skill instead of manually searching through files.

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
import { addColumnToAllTenants, executeOnAllTenants } from '../migrations/migration-helpers.js'

// ✅ CORRECT - Apply changes to ALL existing tenant schemas
export async function up(db: Kysely<unknown>): Promise<void> {
  // Add a column to all tenant schemas
  await addColumnToAllTenants(db, 'messages', 'new_column', 'VARCHAR(100)')

  // Or use the generic helper for custom operations
  await executeOnAllTenants(db, async (schemaName) => {
    await sql`ALTER TABLE ${sql.raw(`"${schemaName}".messages`)} ADD COLUMN ...`.execute(db)
  })

  // IMPORTANT: Also update migration 015's setup_tenant_schema function
  // so NEW tenants created after this migration get the column too
}
```

**Common pitfall**: The `setup_tenant_schema` function was historically overwritten in multiple migrations (009-014), causing inconsistent schemas. Migration 015 established this function as the single source of truth. For new columns/tables, update ONLY migration 015's function definition.

## Dark Mode

The application supports light, dark, and system-preference themes. The theme system uses CSS class-based toggling with Tailwind v4's `@custom-variant`.

### Using Theme in Components

```typescript
import { useTheme } from '@/contexts/theme-context'

function MyComponent() {
  const { theme, resolvedTheme, setTheme, toggleTheme } = useTheme()

  // theme: 'light' | 'dark' | 'system'
  // resolvedTheme: 'light' | 'dark' (actual applied theme)
  // setTheme: set to specific theme
  // toggleTheme: cycle through light → dark → system
}
```

### Semantic Color Reference

Use these semantic colors for dark mode styling (defined in `apps/web/src/index.css`):

| Color | Value | Usage |
|-------|-------|-------|
| `dark-primary` | #111B21 | Main background (message thread) |
| `dark-secondary` | #1F2C33 | Sidebar, headers, cards |
| `dark-elevated` | #202C33 | Elevated surfaces (bubbles, dropdowns) |
| `dark-tertiary` | #2A3942 | Selected/hover states |
| `dark-border` | #2F3B43 | Borders and dividers |
| `dark-text-primary` | #E9EDEF | Primary text |
| `dark-text-secondary` | #8696A0 | Secondary text |
| `dark-text-tertiary` | #667781 | Muted text, placeholders |

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
