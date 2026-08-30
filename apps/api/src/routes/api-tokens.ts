import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { forbidden, notFound } from "../lib/errors.js";
import { created, successData, successMessage } from "../lib/response.js";
import {
  createApiTokenSchema,
  listApiTokensQuerySchema,
} from "../lib/schemas/index.js";
import { authMiddleware } from "../middleware/auth.js";
import { getRouteContext } from "../middleware/context.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import {
  type ApiTokenSummary,
  createApiToken,
  listApiTokens,
  revokeApiToken,
} from "../services/api-token.service.js";

export const apiTokenRoutes = new Hono();

// Token management uses the normal web session, never API tokens themselves.
apiTokenRoutes.use("/*", authMiddleware);
apiTokenRoutes.use("/*", tenantMiddleware());

function serialize(token: ApiTokenSummary) {
  return {
    id: token.id,
    userId: token.userId,
    name: token.name,
    tokenPrefix: token.tokenPrefix,
    scopes: token.scopes,
    lastUsedAt: token.lastUsedAt,
    expiresAt: token.expiresAt,
    revokedAt: token.revokedAt,
    createdAt: token.createdAt,
  };
}

/**
 * POST /api-tokens - Create an API token; the secret is returned only once
 */
apiTokenRoutes.post("/", zValidator("json", createApiTokenSchema), async (c) => {
  const { user, companyId } = getRouteContext(c);
  const body = c.req.valid("json");

  const { token, summary } = await createApiToken({
    userId: user.id,
    companyId,
    name: body.name,
    scopes: body.scopes,
    expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
  });

  return created(c, { token, ...serialize(summary) });
});

/**
 * GET /api-tokens - List own tokens; ?all=true lists all workspace tokens (admin/owner)
 */
apiTokenRoutes.get(
  "/",
  zValidator("query", listApiTokensQuerySchema),
  async (c) => {
    const { user, companyId, role } = getRouteContext(c);
    const { all } = c.req.valid("query");

    if (all && role === "member") {
      return forbidden(c, "Only admins can list all workspace tokens");
    }

    const tokens = await listApiTokens(companyId, {
      userId: all ? undefined : user.id,
    });
    return successData(c, tokens.map(serialize));
  },
);

/**
 * DELETE /api-tokens/:id - Revoke a token (own; admins may revoke any)
 */
apiTokenRoutes.delete("/:id", async (c) => {
  const { user, companyId, role } = getRouteContext(c);

  const revoked = await revokeApiToken({
    tokenId: c.req.param("id"),
    companyId,
    requesterId: user.id,
    isAdmin: role !== "member",
  });

  if (!revoked) {
    return notFound(c, "API token");
  }
  return successMessage(c, "API token revoked");
});
