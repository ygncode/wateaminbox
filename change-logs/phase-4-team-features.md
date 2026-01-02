# Phase 4: Team Features - Changelog

## Status: COMPLETE

## Overview
Implementing team collaboration features including invitation system, permission management, contact assignment, and audit logging.

---

## Tasks

### 4.1 Team Invitation System
- [x] Invite team members by email
- [x] Accept/reject invitation flow
- [x] Resend invitation
- [x] Cancel pending invitation
- [x] Invitation expiry (7 days)

### 4.2 Permission System
- [x] Role-based access control (Owner, Admin, Member)
- [x] Role hierarchy enforcement
- [x] Permission middleware for API routes
- [x] Role change UI for admins

### 4.3 Contact Assignment
- [x] Assign contact to team member
- [x] Reassign contact
- [x] Unassign contact
- [x] View assigned contacts filter
- [x] Assignment history

### 4.4 Audit Logging
- [x] Log all significant actions
- [x] View audit log UI
- [x] Filter by user, action type, date range
- [x] Export audit logs

---

## Completed Items

### 4.1 Team Invitation System (2026-01-01)

**Files Created (Frontend):**
- `apps/web/src/hooks/useTeam.ts` - React Query hooks for team management:
  - `useCompanyMembers(companyId)` - Fetch company members
  - `usePendingInvitations(companyId)` - Fetch pending invitations
  - `useInviteMember()` - Send new invitation
  - `useCancelInvitation()` - Cancel pending invitation
  - `useResendInvitation()` - Resend invitation with new token
  - `useUpdateMemberRole()` - Change member role
  - `useRemoveMember()` - Remove member from company
  - `useInvitationByToken(token)` - Get invitation details
  - `useAcceptInvitation()` - Accept invitation

- `apps/web/src/components/team/TeamManagement.tsx` - Team management UI:
  - Members list with role badges (Owner, Admin, Member)
  - Role change dropdown (Admin/Member toggle)
  - Remove member functionality
  - Pending invitations list
  - Resend invitation button
  - Cancel invitation button
  - Invite member modal with email input and role selection

- `apps/web/src/components/team/index.ts` - Barrel export

**Files Modified (Backend):**
- `apps/api/src/routes/companies.ts`:
  - Added `GET /invitations/:token` - Returns invitation details (company name, inviter, expiry)
  - Added `POST /companies/:id/invitations/:invitationId/resend` - Resend with new token and extended expiry

- `apps/api/src/services/company.service.ts`:
  - Added `getInvitationByToken(token)` - Get invitation details for preview
  - Added `resendInvitation(companyId, invitationId, userId)` - Regenerate token and extend expiry

**Features:**
- Invite members by email with role selection (Admin/Member)
- 7-day invitation expiry with resend option
- Accept invitation via token link
- Cancel pending invitations
- Visual feedback for expiring invitations
- Role-based UI (only admins/owners see management options)

---

### 4.2 Permission System (2026-01-01)

**Pre-existing Implementation:**
- `apps/api/src/middleware/tenant.ts` - Role-based middleware:
  - `tenantMiddleware({ requiredRole })` - Enforces minimum role for route access
  - `tenantFromParam(paramName, requiredRole)` - Shorthand for routes with company ID in URL
  - `requireAdmin()` - Helper middleware requiring admin role
  - `requireOwner()` - Helper middleware requiring owner role
  - Role hierarchy: owner (3) > admin (2) > member (1)

- `apps/api/src/services/company.service.ts`:
  - `getMemberRole(companyId, userId)` - Get user's role in company
  - `hasPermission(companyId, userId, requiredRole)` - Check role hierarchy
  - `updateMemberRole(companyId, userId, newRole)` - Change member role (can't change owner)

**Features:**
- Three roles: Owner, Admin, Member
- Role hierarchy enforcement at API level
- Owner cannot be demoted or removed
- Admins can manage members and invitations
- Members have read access only

---

### 4.3 Contact Assignment (2026-01-01)

**Pre-existing Implementation (Phase 3):**
- `apps/api/src/routes/contacts.ts`:
  - `POST /contacts/:id/assign` - Assign contact to current user
  - `DELETE /contacts/:id/assign` - Unassign contact
  - Assignment stored in `contact_assignments` table with history

- `apps/web/src/components/chat/ContactProfile.tsx`:
  - AssignmentSection component with assign/unassign buttons
  - Shows current assignment info

### 4.3.1 View Assigned Contacts Filter (2026-01-02)

**Files Modified (Backend):**
- `apps/api/src/routes/contacts.ts` - Added query params:
  - `assignedToMe=true` - Filter to show only contacts assigned to current user
  - `unassigned=true` - Filter to show only unassigned contacts
  - Added `assignedTo` field to response

**Files Modified (Frontend):**
- `apps/web/src/hooks/useChats.ts` - Added:
  - `AssignmentFilter` type ("all" | "assignedToMe" | "unassigned")
  - Updated query key factory to include assignment filter
  - Updated `useChats` hook to accept `assignmentFilter` parameter
- `apps/web/src/types/chat.ts` - Added `assignedTo` field to Chat interface
- `apps/web/src/components/chat/ChatList.tsx` - Added:
  - Assignment filter state management
  - Filter button group UI (All, Assigned to me, Unassigned)
  - WhatsApp-style pill buttons with active state styling

### 4.3.2 Assignment History (2026-01-02)

**Files Created (Backend):**
- `apps/api/src/routes/contacts.ts` - Added endpoint:
  - `GET /contacts/:id/assignments` - Returns full assignment history with timestamps

**Files Modified (Frontend):**
- `apps/web/src/hooks/useContact.ts` - Added:
  - `AssignmentHistoryEntry` type
  - `useAssignmentHistory(contactId)` hook
  - Updated assign/unassign hooks to invalidate history cache
- `apps/web/src/components/chat/ContactProfile.tsx` - Added:
  - `AssignmentHistorySection` component with:
    - Collapsible history list (shows 3 entries by default)
    - Active assignment highlighted in green
    - Shows assigned by, dates, and timestamps
    - Expand/collapse for more than 3 entries

---

### 4.4 Audit Logging (2026-01-01)

**Files Created (Backend):**
- `apps/api/src/services/audit.service.ts` - Audit service:
  - `createAuditLog(input)` - Log an action (non-blocking, won't throw)
  - `getAuditLogs(params)` - Query logs with filters
  - `getClientIp(headers)` - Extract client IP from request
  - 17 action types covering auth, invitations, members, contacts, messages, tags

- `apps/api/src/routes/audit.ts` - Audit API routes:
  - `GET /audit` - List audit logs with filters (userId, action, entityType, dates)
  - `GET /audit/actions` - List available action types
  - `GET /audit/export` - Export as CSV file

**Files Created (Frontend):**
- `apps/web/src/hooks/useAudit.ts` - React Query hooks:
  - `useAuditLogs(companyId, params)` - Fetch paginated audit logs
  - `useAuditActions()` - Fetch action type list
  - `formatAuditAction(action)` - Format action for display
  - `getActionCategory(action)` - Get category prefix

- `apps/web/src/components/team/AuditLog.tsx` - Audit log viewer:
  - Paginated log list with expandable details
  - Action type filter dropdown
  - Date range filters
  - CSV export button
  - Display of user, timestamp, IP address
  - Expandable JSON details view

**Action Types:**
- user.login, user.logout
- invitation.sent, invitation.accepted, invitation.cancelled, invitation.resent
- member.role_changed, member.removed
- contact.created, contact.updated, contact.assigned, contact.unassigned
- message.sent, message.deleted
- tag.created, tag.deleted
- company.updated

---

## Notes

- Building on existing company/invitation API endpoints from Phase 2
- Permission system integrates with existing tenant middleware
- Contact assignment partially implemented in Phase 3 (basic assign/unassign)
- Audit logs stored in tenant schema's audit_logs table

---

## Last Updated
2026-01-02
