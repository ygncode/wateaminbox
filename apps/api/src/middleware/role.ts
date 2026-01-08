import { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";

/**
 * Helper to require admin role
 * Use this after tenantMiddleware to enforce admin-only access
 */
export function requireAdmin() {
  return async (c: Context, next: Next) => {
    const role = c.get("companyRole");
    if (role !== "owner" && role !== "admin") {
      throw new HTTPException(403, {
        message: "Admin privileges required",
      });
    }
    await next();
  };
}

/**
 * Helper to require owner role
 * Use this after tenantMiddleware to enforce owner-only access
 */
export function requireOwner() {
  return async (c: Context, next: Next) => {
    const role = c.get("companyRole");
    if (role !== "owner") {
      throw new HTTPException(403, {
        message: "Owner privileges required",
      });
    }
    await next();
  };
}
