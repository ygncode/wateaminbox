import type { Context } from "hono";
import type { Kysely } from "kysely";
import type { TenantDatabase } from "../services/tenant.service.js";
import type { MemberPermissions } from "../services/permission.service.js";

/**
 * User type from the auth middleware context
 */
export interface RouteUser {
  id: string;
  email: string;
  name: string | null;
  emailVerifiedAt: Date | null;
}

/**
 * Route context containing tenant-specific variables
 * These are set by the auth and tenant middleware
 */
export interface RouteContext {
  /** Tenant-scoped database connection */
  tenantDb: Kysely<TenantDatabase>;
  /** Authenticated user */
  user: RouteUser;
  /** Current company ID */
  companyId: string;
  /** User's permissions for the current company */
  permissions: MemberPermissions;
  /** User's role in the current company */
  role: "owner" | "admin" | "member";
}

/**
 * Get the route context from a Hono context.
 *
 * This helper extracts commonly used context variables in a single call,
 * reducing boilerplate across route handlers.
 *
 * @example
 * ```ts
 * app.get('/contacts', async (c) => {
 *   const { tenantDb, user, companyId } = getRouteContext(c)
 *
 *   const contacts = await tenantDb
 *     .selectFrom('contacts')
 *     .where('assigned_to', '=', user.id)
 *     .execute()
 *
 *   return c.json({ data: contacts })
 * })
 * ```
 *
 * @param c - The Hono context from a route handler
 * @returns The route context with tenantDb, user, companyId, permissions, and role
 */
export function getRouteContext(c: Context): RouteContext {
  return {
    tenantDb: c.get("tenantDb"),
    user: c.get("user"),
    companyId: c.get("companyId"),
    permissions: c.get("companyPermissions"),
    role: c.get("companyRole"),
  };
}

/**
 * Get partial route context when not all variables are needed.
 *
 * Use this when you only need a subset of the context variables,
 * or when some variables may not be available (e.g., tenant context is optional).
 *
 * @example
 * ```ts
 * app.get('/public', async (c) => {
 *   const { user } = getPartialRouteContext(c)
 *   if (user) {
 *     // User is authenticated
 *   }
 *   return c.json({ public: true })
 * })
 * ```
 *
 * @param c - The Hono context from a route handler
 * @returns Partial route context where all fields may be undefined
 */
export function getPartialRouteContext(c: Context): Partial<RouteContext> {
  return {
    tenantDb: c.get("tenantDb"),
    user: c.get("user"),
    companyId: c.get("companyId"),
    permissions: c.get("companyPermissions"),
    role: c.get("companyRole"),
  };
}

/**
 * Type guard to check if a partial context has all required fields
 */
export function isCompleteContext(
  ctx: Partial<RouteContext>,
): ctx is RouteContext {
  return (
    ctx.tenantDb !== undefined &&
    ctx.user !== undefined &&
    ctx.companyId !== undefined &&
    ctx.permissions !== undefined &&
    ctx.role !== undefined
  );
}
