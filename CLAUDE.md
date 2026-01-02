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
