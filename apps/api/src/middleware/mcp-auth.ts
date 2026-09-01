import { issuer } from "../routes/oauth.js";
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
/**
 * Point an unauthenticated caller at the protected-resource metadata.
 *
 * RFC 9728 says a 401 carries this header, and it is the first thing an MCP
 * client looks for; without it a client has no way to learn which
 * authorization server to use and simply reports a failed connection. Claude
 * only honours the challenge on a 401, so this must never move to a 200.
 */
function unauthorized(c: Context, message: string) {
  c.header(
    "WWW-Authenticate",
    `Bearer resource_metadata="${issuer()}/.well-known/oauth-protected-resource"`,
  );
  return c.json({ error: "Unauthorized", message }, 401);
}

export const mcpAuthMiddleware = async (c: Context, next: Next) => {
  const token = extractToken(c.req.header("Authorization"));
  if (!token || !token.startsWith(API_TOKEN_PREFIX)) {
    return unauthorized(
      c,
      "An API token (wti_...) is required in the Authorization header",
    );
  }

  const verified = await verifyApiToken(token);
  if (!verified) {
    return unauthorized(c, "Invalid, expired, or revoked API token");
  }

  const user = await getUserById(verified.userId);
  if (!user) {
    return unauthorized(c, "Token owner no longer exists");
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
