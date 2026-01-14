# GEMINI.md

## Project Overview
Monorepo for a Multi-tenant WhatsApp Web business platform (WhatsApp Business API alternative).
Enables businesses to manage WhatsApp communications with team collaboration, contact assignment, and audit logging.

## Tech Stack
- **Frontend:** React 18, Vite, Shadcn UI, Tailwind v4, TanStack Query, Zustand.
- **Backend:** Hono (Bun runtime), PostgreSQL 16 (Kysely), NATS JetStream.
- **Go Services:** Orchestrator (Lifecycle), WhatsApp (whatsmeow client).
- **Infrastructure:** Docker (Postgres, NATS, Meilisearch, MinIO), Cloudflare R2, Resend.
- **Monorepo Tooling:** Turbo, Bun Workspaces, Biome.

## Architecture
- **apps/web:** Frontend application (Port 4444).
- **apps/api:** Backend API (Port 4445).
- **apps/marketing:** Astro marketing site (Port 4446).
- **services/orchestrator:** Go service managing worker lifecycle (Port 8080).
- **services/whatsapp:** Go WhatsApp client (one process per account).
- **packages/database:** Shared Kysely client & migrations.
- **packages/shared:** Shared TypeScript types and utilities.

**Data Flow:** Browser <-> Hono API <-> NATS JetStream <-> Go Services <-> WhatsApp

## Critical Guidelines

### 1. Database Schema & Migrations
- **Schema-per-tenant:** Each company has its own schema (`tenant_{id}`).
- **Migration Helpers:** ALWAYS use `packages/database/src/migrations/migration-helpers.ts` (`addColumnToAllTenants`, etc.).
- **Consistency:** Update migration `015`'s `setup_tenant_schema` function for new tables/columns to ensure *future* tenants get them too.
- **Fixing Issues:** Fix the root cause in migration files. DO NOT apply hot patches.

### 2. Date & Time Handling
- **Strict UTC:** Storage and processing must be in UTC.
- **Library:** Use `@whatsapp-web/shared` exports (`now()`, `toDbDate()`, `nowMs()`).
- **Forbidden:** `new Date()`, `Date.now()`.
- **Display:** Use formatters from shared package (`formatMessageTime`, `formatChatListTime`) which handle local time conversion.

### 3. Development Environment
- **Startup:** `./dev-start.sh` is the master script. It handles Docker, deps, migrations, and service startup.
- **Hot Reload:** Enabled for Frontend, API, and Go services (via `air`).
- **Prerequisites:** Docker, Bun, Go, Air.

## Key Commands

### Build & Run
- **Start Dev Env:** `./dev-start.sh` (Preferred) or `./dev-start.sh &`
- **Build All:** `bun run build`
- **Clean:** `bun run clean`

### Testing
- **All Tests:** `bun run test`
- **Backend Unit:** `cd apps/api && bun test`
- **E2E:** `cd apps/web && bunx playwright test`
- **Go:** `cd services/orchestrator && go test ./...`

### Database
- **Migrate:** `bun run db:migrate`
- **Generate Types:** `bun run db:generate`

## Code Style & Conventions
- **Linter/Formatter:** Biome (`bun run format`).
- **Theme:** Dark mode supported via `dark:` variant and semantic colors (e.g., `dark-primary`, `dark-elevated`).
- **State Management:** Zustand for global client state.
- **API Client:** Hono RPC or standard fetch with JWT auth.
