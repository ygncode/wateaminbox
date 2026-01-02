# Phase 1: Foundation - Changelog

## Status: COMPLETE

## Overview
Setting up the monorepo structure, tooling, Docker Compose, database schema, authentication, and company/tenant setup.

---

## Tasks

### 1.1 Project Setup (Monorepo, Tooling, Linting)
- [x] Initialize Turborepo monorepo structure
- [x] Setup `apps/web` (React + Vite + Bun)
- [x] Setup `apps/api` (Hono + Bun)
- [x] Setup `apps/marketing` (Astro)
- [x] Setup `services/whatsapp` (Go)
- [x] Setup `services/orchestrator` (Go)
- [x] Configure Biome for TypeScript projects
- [x] Configure golangci-lint for Go services
- [x] Setup shared packages structure

### 1.2 Docker Compose Configuration
- [x] PostgreSQL service (port 5433)
- [x] NATS JetStream service
- [x] Meilisearch service
- [x] Local R2-compatible storage (MinIO)

### 1.3 Database Schema + Migrations
- [x] Setup Kysely with PostgreSQL
- [x] Create public schema tables (companies, users, company_members, invitations, company_stats, user_sessions)
- [x] Create tenant schema template with setup_tenant_schema function
- [x] Migration system for schema-per-tenant

### 1.4 Authentication System
- [x] JWT tokens with refresh token flow (jose library, 15min access + 7d refresh)
- [x] Email + password registration
- [x] Email verification (Resend integration)
- [x] Login endpoint
- [x] Password reset flow
- [x] Device-based sessions
- [x] Session management endpoints

### 1.5 Company/Tenant Setup
- [x] Create company on registration
- [x] Tenant schema creation (setup_tenant_schema function)
- [x] Join company via invite link
- [x] Company profile settings (CRUD endpoints)

---

## Completed Items

### 2026-01-01 - Initial Setup
- Created Turborepo monorepo structure with workspaces
- Setup React web app with Vite, TanStack Query, Tailwind CSS v4, React Router
- Setup Hono API server with health check routes, CORS, logging
- Setup Astro marketing site with landing, pricing, blog, docs, changelog pages
- Created shared packages: @whatsapp-web/shared, @whatsapp-web/database, @whatsapp-web/ui
- Created Go orchestrator service with NATS client and process manager
- Created Go WhatsApp service with whatsmeow client wrapper and event handlers
- Docker Compose with PostgreSQL, NATS JetStream, Meilisearch, MinIO
- Kysely database migrations for public schema and tenant schema template

### 2026-01-01 - Authentication System
- JWT utilities with jose library (generateAccessToken, generateRefreshToken, verifyAccessToken, verifyRefreshToken)
- Password hashing with bcrypt (12 rounds) and strength validation
- Email service with Resend integration (dev mode logs, prod sends via API)
- Complete auth service with register, login, verifyEmail, forgotPassword, resetPassword, refreshSession
- Auth middleware with JWT verification, optional auth, email verification requirement
- Auth routes: /auth/register, /auth/login, /auth/logout, /auth/verify-email, /auth/forgot-password, /auth/reset-password, /auth/refresh, /auth/sessions, /auth/me

### 2026-01-01 - Company/Tenant Management
- Tenant service with schema creation/deletion using PostgreSQL functions
- Tenant connection caching for database performance
- Company service with full CRUD, member management, invitations
- Company routes: /companies CRUD, /companies/:id/members, /companies/:id/invitations
- Invitation routes: /invitations/:token/accept for joining companies
- Tenant middleware for extracting company context from header/param with role validation
- Updated database package with full type definitions for public and tenant schemas

---

## Notes

- Using Bun as runtime for Node.js projects
- Schema-per-tenant isolation pattern
- JWT with 15min expiry + refresh tokens
- PostgreSQL on port 5433 to avoid conflicts
- MinIO for local S3-compatible storage

---

## Last Updated
2026-01-01

