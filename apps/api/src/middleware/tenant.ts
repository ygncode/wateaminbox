import { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  getTenantConnection,
  TenantDatabase,
} from "../services/tenant.service.js";
import { getMemberRole } from "../services/company.service.js";
import {
  getMemberWithPermissions,
  type MemberPermissions,
  type Permission,
} from "../services/permission.service.js";
import type { Kysely } from "kysely";

// Extend Hono context types for tenant-specific variables
// Note: user, session types are defined in auth.ts middleware
declare module "hono" {
  interface ContextVariableMap {
    companyId: string;
    companyRole: "owner" | "admin" | "member";
    companyPermissions: MemberPermissions;
    tenantDb: Kysely<TenantDatabase>;
  }
}

export interface TenantContextOptions {
  /**
   * How to extract the company ID:
   * - "header": From X-Company-ID header
   * - "param": From route parameter (default param name: "companyId")
   * - "jwt": From JWT claims
   */
  source?: "header" | "param" | "jwt";

  /**
   * Parameter name when source is "param"
   */
  paramName?: string;

  /**
   * Header name when source is "header"
   */
  headerName?: string;

  /**
   * Whether to require the tenant context
   */
  required?: boolean;

  /**
   * Minimum required role to access this tenant
   */
  requiredRole?: "owner" | "admin" | "member";
}

const defaultOptions: TenantContextOptions = {
  source: "header",
  headerName: "X-Company-ID",
  required: true,
  requiredRole: "member",
};

/**
 * Tenant context middleware
 * Extracts company ID from request and sets up tenant database connection
 */
export function tenantMiddleware(options: TenantContextOptions = {}) {
  const opts = { ...defaultOptions, ...options };

  return async (c: Context, next: Next) => {
    let companyId: string | undefined;

    // Extract company ID based on source
    switch (opts.source) {
      case "header":
        companyId = c.req.header(opts.headerName || "X-Company-ID");
        break;

      case "param":
        companyId = c.req.param(opts.paramName || "companyId");
        break;

      case "jwt":
        // JWT mode is not currently supported since the user object doesn't contain companyId
        // This is a placeholder for future implementation when JWT contains company context
        throw new HTTPException(501, {
          message: "JWT-based company context is not yet implemented",
        });
    }

    // Handle missing company ID
    if (!companyId) {
      if (opts.required) {
        throw new HTTPException(400, {
          message: `Company ID is required. Provide it via ${opts.source === "header" ? opts.headerName : opts.source}`,
        });
      }
      // Not required, continue without tenant context
      await next();
      return;
    }

    // Validate UUID format
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(companyId)) {
      throw new HTTPException(400, {
        message: "Invalid company ID format",
      });
    }

    // Get user from context (should be set by auth middleware)
    const user = c.get("user");
    if (!user?.id) {
      throw new HTTPException(401, {
        message: "Authentication required",
      });
    }

    // Check if user is a member of this company and get their role + permissions
    const memberData = await getMemberWithPermissions(companyId, user.id);
    if (!memberData) {
      throw new HTTPException(403, {
        message: "You are not a member of this company",
      });
    }

    const { role, permissions } = memberData;

    // Check role hierarchy if required
    if (opts.requiredRole) {
      const roleHierarchy: Record<string, number> = {
        owner: 3,
        admin: 2,
        member: 1,
      };

      if (roleHierarchy[role] < roleHierarchy[opts.requiredRole]) {
        throw new HTTPException(403, {
          message: `This action requires ${opts.requiredRole} role or higher`,
        });
      }
    }

    // Set context variables
    c.set("companyId", companyId);
    c.set("companyRole", role);
    c.set("companyPermissions", permissions);
    c.set("tenantDb", getTenantConnection(companyId));

    await next();
  };
}

/**
 * Shorthand middleware for routes that get company ID from URL parameter
 */
export function tenantFromParam(
  paramName: string = "id",
  requiredRole?: "owner" | "admin" | "member",
) {
  return tenantMiddleware({
    source: "param",
    paramName,
    required: true,
    requiredRole,
  });
}

/**
 * Shorthand middleware for routes that get company ID from header
 */
export function tenantFromHeader(
  headerName: string = "X-Company-ID",
  requiredRole?: "owner" | "admin" | "member",
) {
  return tenantMiddleware({
    source: "header",
    headerName,
    required: true,
    requiredRole,
  });
}

/**
 * Helper to require admin role
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
