/**
 * Tenant Middleware Module
 *
 * This module provides middleware for multi-tenant context management.
 * It is split into focused sub-modules:
 *
 * - tenant-context.ts: Tenant extraction and database setup
 * - role.ts: Role validation (admin, owner)
 * - permission.ts: Feature-based permission checking
 *
 * All exports are re-exported here for backward compatibility.
 */

// Re-export permission middleware
export {
  requireAllPermissions,
  requireAnyPermission,
  requirePermission,
} from "./permission.js";

// Re-export role middleware
export { requireAdmin, requireOwner } from "./role.js";
// Re-export tenant context middleware
export {
  type TenantContextOptions,
  tenantFromHeader,
  tenantFromParam,
  tenantMiddleware,
} from "./tenant-context.js";
