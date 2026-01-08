import { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Permission } from "../services/permission.service.js";

/**
 * Helper to require a specific permission
 * Use this after tenantMiddleware to check feature-based permissions
 */
export function requirePermission(permission: Permission) {
  return async (c: Context, next: Next) => {
    const permissions = c.get("companyPermissions");
    if (!permissions || !permissions[permission]) {
      throw new HTTPException(403, {
        message: `Permission denied: ${permission} is required`,
      });
    }
    await next();
  };
}

/**
 * Helper to require all of the specified permissions
 */
export function requireAllPermissions(requiredPermissions: Permission[]) {
  return async (c: Context, next: Next) => {
    const permissions = c.get("companyPermissions");
    if (!permissions) {
      throw new HTTPException(403, {
        message: "Permission denied: no permissions found",
      });
    }

    const missing = requiredPermissions.filter((p) => !permissions[p]);
    if (missing.length > 0) {
      throw new HTTPException(403, {
        message: `Permission denied: missing ${missing.join(", ")}`,
      });
    }
    await next();
  };
}

/**
 * Helper to require any of the specified permissions
 */
export function requireAnyPermission(requiredPermissions: Permission[]) {
  return async (c: Context, next: Next) => {
    const permissions = c.get("companyPermissions");
    if (!permissions) {
      throw new HTTPException(403, {
        message: "Permission denied: no permissions found",
      });
    }

    const hasAny = requiredPermissions.some((p) => permissions[p]);
    if (!hasAny) {
      throw new HTTPException(403, {
        message: `Permission denied: requires one of ${requiredPermissions.join(", ")}`,
      });
    }
    await next();
  };
}
