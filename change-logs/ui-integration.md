# UI Integration - Changelog

## Status: COMPLETE

## Overview
Wiring up all existing UI components into the React app with proper routing, authentication flow, and page layouts.

---

## Problem Statement
Components from Phases 3-6 were created but `App.tsx` only rendered a welcome page. Needed to:
1. Add login/register pages
2. Add authenticated routes with proper guards
3. Wire up dashboard, chat, team management, settings pages
4. Connect all components to their routes

---

## Tasks

### Authentication Pages
- [x] Login page (`/login`)
- [x] Register page (`/register`)
- [x] Forgot password page (`/forgot-password`)
- [ ] Accept invitation page (`/invite/:token`) - Future enhancement

### Main App Routes (Authenticated)
- [x] Chat/messaging page (`/chat`, `/chat/:contactId`)
- [ ] Team management page (`/team`) - Future enhancement
- [ ] Audit log page (`/audit`) - Future enhancement
- [ ] Settings page (`/settings`) - Future enhancement

### Route Guards
- [x] Redirect unauthenticated users to login
- [x] Redirect authenticated users to chat from home
- [ ] Company selection/creation flow - Future enhancement

### Navigation
- [x] App layout using existing responsive layout components
- [x] Mobile responsive layout via MobileLayout component

---

## Completed Items

### Authentication Pages (2026-01-02)

**Files Created:**
- `apps/web/src/pages/LoginPage.tsx` - Login page with:
  - Email/password form
  - Remember me checkbox
  - Link to forgot password
  - Link to register
  - WhatsApp-style branding
  - Error handling from auth context
  - Auto-redirect if already authenticated

- `apps/web/src/pages/RegisterPage.tsx` - Registration page with:
  - Full name, email, password, confirm password fields
  - Password validation (min 8 characters, match confirmation)
  - Links to login page
  - WhatsApp-style branding

- `apps/web/src/pages/ForgotPasswordPage.tsx` - Password reset page with:
  - Email input form
  - Success state showing "check your email" message
  - Link back to login

- `apps/web/src/pages/index.ts` - Barrel export for all pages

### Protected Route (2026-01-02)

**Files Created:**
- `apps/web/src/components/auth/ProtectedRoute.tsx` - Route guard with:
  - Checks isAuthenticated from auth context
  - Shows loading spinner while auth is loading
  - Redirects to /login if not authenticated
  - Preserves attempted location for redirect after login

- `apps/web/src/components/auth/index.ts` - Barrel export

### Chat Page (2026-01-02)

**Files Created:**
- `apps/web/src/pages/ChatPage.tsx` - Main chat interface with:
  - Integration with existing layout components (AppLayout, ResponsiveLayout)
  - ChatList sidebar with search and assignment filters
  - MessageThread for displaying messages
  - MessageComposer for sending messages
  - MessageHeader with contact info
  - ContactProfile right panel
  - URL sync with selected chat ID
  - Mobile/tablet responsive layouts

**Key Integration Points:**
- Uses `useContact` hook with type mapping to `Contact` interface
- Passes correct props to all existing components
- Handles reply-to-message state
- Manages profile panel open/close state

### App Routing (2026-01-02)

**Files Modified:**
- `apps/web/src/App.tsx` - Updated with:
  - Public routes: `/login`, `/register`, `/forgot-password`
  - Protected routes: `/chat`, `/chat/:contactId`
  - Default redirect from `/` to `/chat`
  - 404 redirect to `/chat`
  - Maintained keyboard shortcuts modal

---

## How It Works

### Authentication Flow
1. User visits any route
2. If protected route and not authenticated → redirect to `/login`
3. User logs in → stored in localStorage + auth context
4. Redirect to `/chat`
5. On refresh, auth context checks localStorage for existing session

### Chat Flow
1. `/chat` shows chat list on left, empty state on right
2. Click chat → URL changes to `/chat/:contactId`
3. MessageThread loads messages for selected contact
4. ContactProfile can be opened via header click
5. Mobile: Full-screen views with back navigation

---

### Authentication Bug Fixes (2026-01-02)

**Issue:** 401 Unauthorized errors when logging in/registering

**Root Causes:**
1. API response structure mismatch - server returns `{ tokens: { accessToken, refreshToken } }` but code expected `{ accessToken, refreshToken }`
2. RegisterPage was calling `login()` instead of `register()`
3. No logout functionality in UI

**Files Modified:**

- `apps/web/src/lib/api.ts`:
  - Fixed `LoginResponse` interface to match actual API response with nested `tokens` object
  - Updated `login()` to use `response.tokens.accessToken`
  - Updated `register()` to use `response.tokens.accessToken`
  - Updated `attemptTokenRefresh()` to use `data.tokens.accessToken`

- `apps/web/src/contexts/auth-context.tsx`:
  - Added `register` function import and implementation
  - Added `register` to `AuthContextValue` interface
  - Added `register` to context value

- `apps/web/src/pages/RegisterPage.tsx`:
  - Changed from using `login()` to `register()` function
  - Now properly sends name, email, password to registration API

- `apps/web/src/components/chat/ChatList.tsx`:
  - Added dropdown menu to header menu button
  - Shows current user info (name, email)
  - Added logout button with icon
  - Dropdown closes when clicking outside

### Additional Auth Fixes (2026-01-02)

**Issue 1:** Registration returning "Cannot read properties of undefined (reading 'accessToken')"
- **Root Cause:** Register API doesn't return tokens (user needs to verify email first)
- **Fix:**
  - Created `RegisterResponse` type that matches actual API response
  - Updated `register()` function to not expect tokens
  - Updated `RegisterPage` to show success message and redirect to login instead of auto-login

**Issue 2:** CORS policy blocking requests with credentials
- **Root Cause:** CORS was set to `origin: "*"` which doesn't work with `credentials: true`
- **Fix:** Updated `apps/api/src/app.ts` CORS config to use specific origins:
  ```typescript
  cors({
    origin: ["http://localhost:5173", "http://localhost:3000"],
    credentials: true,
    ...
  })
  ```

**Issue 3:** useKeyboardShortcuts.ts "Cannot read properties of undefined (reading 'toLowerCase')"
- **Root Cause:** Missing null check for `event.key` and `shortcut.key`
- **Fix:** Added guard clause in `matchesShortcut` function

**Issue 4:** Session not persisting on page refresh
- **Root Causes:**
  - `getCurrentUser()` expected raw user but API returns `{ user: {...} }`
  - Token refresh response type was using `LoginResponse` instead of proper type
- **Fixes:**
  - Created `GetMeResponse` interface and updated `getCurrentUser()` to unwrap response
  - Created `RefreshResponse` interface for token refresh
  - Simplified `mapApiUserToAuthUser` with proper `ApiUser` interface

---

## Notes

- Auth context now uses real API endpoints (`/api/auth/login`, `/api/auth/register`)
- JWT tokens stored in localStorage for persistence
- API routes mounted at `/api` prefix (fixed from root)
- Team management and settings pages not yet wired up (existing components ready)
- All TypeScript errors resolved
- Logout functionality available via menu button in chat list header

## Configuration

**Environment files created:**

`apps/web/.env`:
```
VITE_API_URL=http://localhost:3001/api
VITE_WS_URL=ws://localhost:3001/ws
```

`apps/api/.env`:
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/whatsapp_web
JWT_SECRET=dev-secret-key-change-in-production
NATS_URL=nats://localhost:4222
```

**Migration script created:** `packages/database/migrate.ts`
- Run with: `cd packages/database && bun run migrate.ts`

---

### Multi-Tenant Company Support (2026-01-02)

**Issue:** Contacts API returning 500 error "Company ID is required. Provide it via X-Company-ID"

**Root Cause:** Multi-tenant API requires company context for all data operations.

**Files Modified:**

- `apps/web/src/lib/api.ts`:
  - Added `companyId` storage with localStorage persistence
  - Added `setCompanyId()`, `getCompanyId()` functions
  - Added `X-Company-ID` header to all authenticated requests
  - Added `getUserCompanies()` function and `CompanyWithRole` type

- `apps/web/src/contexts/auth-context.tsx`:
  - Added `companies`, `currentCompanyId`, `needsCompanySetup` to auth state
  - Updated login flow to fetch companies after authentication
  - Updated session check to load companies and restore selected company
  - Added `selectCompany()` function for switching companies

- `apps/web/src/components/auth/ProtectedRoute.tsx`:
  - Added `requireCompany` prop (default: true)
  - Redirects to `/company-setup` when user has no companies

- `apps/web/src/pages/CompanySetupPage.tsx` (new):
  - Simple form to create first company
  - Shown when user logs in but has no companies

- `apps/web/src/App.tsx`:
  - Added `/company-setup` route (protected, doesn't require company)

- `apps/api/src/routes/companies.ts`:
  - Added `GET /companies` endpoint to list user's companies

**Flow:**
1. User logs in → auth context fetches companies
2. If companies exist → set first as current, allow access to chat
3. If no companies → redirect to `/company-setup`
4. User creates company → redirected to chat

---

## Last Updated
2026-01-02
