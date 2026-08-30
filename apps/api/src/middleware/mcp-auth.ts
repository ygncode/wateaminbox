import type { ApiTokenScope } from "@wateaminbox/database";
import { Context, Next } from "hono";
import {
  API_TOKEN_PREFIX,
  verifyApiToken,
} from "../services/api-token.service.js";
import { getUserById } from "../services/auth.service.js";
import { getMemberWithPermissions } from "../services/permission.service.js";
import { getTenantConnection } from "../services/tenant.service.js";
import { extractToken } from "./auth.js";

declare module "hono" {
  interface ContextVariableMap {
    apiToken: {
      id: string;
      scopes: ApiTokenScope[];
    };
  }
}

/**
 * Authenticates requests carrying an opaque API token (`wti_...`) and sets
 * the same context variables authMiddleware + tenantMiddleware would set,
 * with the workspace resolved from the token instead of X-Company-ID.
 * Role and permissions are re-resolved on every request, so a token never
 * exceeds its owner's live membership.
 */
export const mcpAuthMiddleware = async (c: Context, next: Next) => {
  const token = extractToken(c.req.header("Authorization"));
  if (!token || !token.startsWith(API_TOKEN_PREFIX)) {
    return c.json(
      {
        error: "Unauthorized",
        message: "An API token (wti_...) is required in the Authorization header",
      },
      401,
    );
  }

  const verified = await verifyApiToken(token);
  if (!verified) {
    return c.json(
      { error: "Unauthorized", message: "Invalid, expired, or revoked API token" },
      401,
    );
  }

  const user = await getUserById(verified.userId);
  if (!user) {
    return c.json(
      { error: "Unauthorized", message: "Token owner no longer exists" },
      401,
    );
  }

  const memberData = await getMemberWithPermissions(
    verified.companyId,
    verified.userId,
  );
  if (!memberData) {
    return c.json(
      {
        error: "Forbidden",
        message: "Token owner is no longer a member of this workspace",
      },
      403,
    );
  }

  c.set("user", {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarKey: user.avatarKey,
    emailVerifiedAt: user.emailVerifiedAt,
  });
  c.set("companyId", verified.companyId);
  c.set("companyRole", memberData.role);
  c.set("companyPermissions", memberData.permissions);
  c.set("tenantDb", getTenantConnection(verified.companyId));
  c.set("apiToken", { id: verified.id, scopes: verified.scopes });

  await next();
};
