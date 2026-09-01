/**
 * OAuth 2.1 authorization endpoints for the MCP server.
 *
 * `GET /authorize` validates the request and hands the user to the consent
 * screen in the web app; the SPA then calls `POST /authorize` with the
 * workspace the user picked. Splitting it that way keeps the browser-facing
 * redirect logic here and the interface in React, and means the consent step
 * authenticates with the ordinary session rather than inventing a second
 * mechanism.
 *
 * `POST /token` is machine-facing: form-encoded, no session, RFC 6749 error
 * bodies.
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { env } from "../lib/env.js";
import { rateLimitConfig, rateLimitStore } from "../lib/rate-limit-store.js";
import { createConditionalRateLimiter } from "../middleware/rate-limit.js";
import { createLogger, formatError } from "../lib/logger.js";
import { authMiddleware } from "../middleware/auth.js";
import { getRouteContext } from "../middleware/context.js";
import {
  isAllowedRedirectUri,
  OAuthClientError,
  resolveOAuthClient,
} from "../services/oauth-client.service.js";
import {
  createAuthorizationCode,
  exchangeAuthorizationCode,
  OAuthError,
  parseScopes,
  refreshTokens,
} from "../services/oauth.service.js";
import * as companyService from "../services/company.service.js";

const logger = createLogger("OAuth");

export const oauthRoutes = new Hono();

/**
 * The authorize and token endpoints are reachable by anyone who can reach the
 * host, so they carry their own limit rather than relying on the global one.
 * A real connector authorizes once and refreshes hourly.
 */
const oauthRateLimiter = createConditionalRateLimiter(
  {
    store: rateLimitStore,
    tier: rateLimitConfig.tiers.resource.oauth,
    keyStrategy: "ip",
    keyPrefix: "resource-oauth",
  },
  rateLimitConfig.enabled,
);

/** This authorization server's issuer identifier. */
export function issuer(): string {
  return env.APP_URL.replace(/\/$/, "");
}

/** The canonical MCP resource, and the only audience this server will issue for. */
export function canonicalResource(): string {
  return `${issuer()}/api/mcp`;
}

const authorizeQuerySchema = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(1),
  redirect_uri: z.string().min(1),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal("S256"),
  state: z.string().max(512).optional(),
  scope: z.string().max(256).optional(),
  resource: z.string().min(1).optional(),
});

type AuthorizeQuery = z.infer<typeof authorizeQuerySchema>;

/**
 * Validate everything that must be right before a user is ever shown a consent
 * screen.
 *
 * Errors thrown here must NOT be redirected to the caller's redirect_uri: until
 * the URI is confirmed to belong to the client, sending anything to it is an
 * open redirect.
 */
async function validateAuthorizeRequest(query: AuthorizeQuery) {
  const client = await resolveOAuthClient(query.client_id);
  if (!isAllowedRedirectUri(client, query.redirect_uri)) {
    throw new OAuthError(
      "invalid_request",
      "redirect_uri is not registered for this client",
    );
  }
  const resource = query.resource ?? canonicalResource();
  if (resource !== canonicalResource()) {
    throw new OAuthError(
      "invalid_request",
      `resource must be ${canonicalResource()}`,
    );
  }
  return { client, resource, scopes: parseScopes(query.scope) };
}

/**
 * Entry point for the client's browser redirect. Sends the user to the consent
 * screen, carrying the request through untouched so the SPA can echo it back.
 */
oauthRoutes.get(
  "/authorize",
  oauthRateLimiter,
  zValidator("query", authorizeQuerySchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          error: "invalid_request",
          error_description:
            result.error.issues[0]?.message ?? "Invalid request",
        },
        400,
      );
    }
  }),
  async (c) => {
    const query = c.req.valid("query");
    try {
      await validateAuthorizeRequest(query);
    } catch (error) {
      if (error instanceof OAuthClientError || error instanceof OAuthError) {
        return c.json(
          {
            error: error instanceof OAuthError ? error.code : "invalid_client",
            error_description: error.message,
          },
          400,
        );
      }
      throw error;
    }

    const consent = new URL("/oauth/consent", env.APP_URL.replace(/\/$/, ""));
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) consent.searchParams.set(key, value);
    }
    return c.redirect(consent.toString(), 302);
  },
);

const approveSchema = authorizeQuerySchema.extend({
  companyId: z.string().uuid(),
});

/**
 * Called by the consent screen once the user has approved and chosen a
 * workspace. Returns the URL to send the browser to rather than redirecting,
 * because the caller is fetch() from the SPA.
 */
oauthRoutes.post(
  "/authorize",
  oauthRateLimiter,
  authMiddleware,
  zValidator("json", approveSchema),
  async (c) => {
    const body = c.req.valid("json");
    const { user } = getRouteContext(c);

    let validated: Awaited<ReturnType<typeof validateAuthorizeRequest>>;
    try {
      validated = await validateAuthorizeRequest(body);
    } catch (error) {
      if (error instanceof OAuthClientError || error instanceof OAuthError) {
        return c.json(
          {
            error: error instanceof OAuthError ? error.code : "invalid_client",
            error_description: error.message,
          },
          400,
        );
      }
      throw error;
    }

    // The user may only grant access to a workspace they are actually in, and
    // the grant inherits their own permissions there rather than widening them.
    const companies = await companyService.getUserCompanies(user.id);
    if (!companies.some((company) => company.id === body.companyId)) {
      return c.json(
        {
          error: "invalid_request",
          error_description: "You are not a member of that workspace",
        },
        403,
      );
    }

    const code = await createAuthorizationCode({
      clientId: body.client_id,
      userId: user.id,
      companyId: body.companyId,
      scopes: validated.scopes,
      redirectUri: body.redirect_uri,
      codeChallenge: body.code_challenge,
      resource: validated.resource,
    });

    const redirect = new URL(body.redirect_uri);
    redirect.searchParams.set("code", code);
    if (body.state) redirect.searchParams.set("state", body.state);
    // RFC 9207: clients must be able to tell which authorization server
    // answered, so they can detect a mix-up attack.
    redirect.searchParams.set("iss", issuer());

    return c.json({ redirectTo: redirect.toString() });
  },
);

/**
 * What the consent screen needs to render: who is asking, and for what.
 *
 * Separate from POST /authorize so the screen can show the client's real name
 * rather than a bare URL, and so an unresolvable client fails before the user
 * is asked to approve anything.
 */
oauthRoutes.get(
  "/client-info",
  authMiddleware,
  zValidator(
    "query",
    z.object({
      client_id: z.string().min(1),
      scope: z.string().max(256).optional(),
    }),
  ),
  async (c) => {
    const { client_id, scope } = c.req.valid("query");
    try {
      const client = await resolveOAuthClient(client_id);
      return c.json({
        clientId: client.clientId,
        clientName: client.clientName,
        scopes: parseScopes(scope),
      });
    } catch (error) {
      if (error instanceof OAuthClientError || error instanceof OAuthError) {
        return c.json(
          {
            error: error instanceof OAuthError ? error.code : "invalid_client",
            error_description: error.message,
          },
          400,
        );
      }
      throw error;
    }
  },
);

const tokenSchema = z.union([
  z.object({
    grant_type: z.literal("authorization_code"),
    code: z.string().min(1),
    client_id: z.string().min(1),
    redirect_uri: z.string().min(1),
    code_verifier: z.string().min(43).max(128),
    resource: z.string().optional(),
  }),
  z.object({
    grant_type: z.literal("refresh_token"),
    refresh_token: z.string().min(1),
    client_id: z.string().min(1),
    resource: z.string().optional(),
    scope: z.string().optional(),
  }),
]);

/**
 * Token endpoint. Accepts form encoding, which is what OAuth clients send and a
 * common source of 415s when a server assumes JSON.
 */
oauthRoutes.post("/token", oauthRateLimiter, async (c) => {
  const contentType = c.req.header("content-type") ?? "";
  if (!contentType.includes("application/x-www-form-urlencoded")) {
    return c.json(
      {
        error: "invalid_request",
        error_description:
          "The token endpoint expects application/x-www-form-urlencoded",
      },
      400,
    );
  }

  const form = Object.fromEntries(
    new URLSearchParams(await c.req.text()).entries(),
  );
  const parsed = tokenSchema.safeParse(form);
  if (!parsed.success) {
    return c.json(
      {
        error: "invalid_request",
        error_description:
          parsed.error.issues[0]?.message ?? "Invalid token request",
      },
      400,
    );
  }
  const body = parsed.data;

  try {
    const client = await resolveOAuthClient(body.client_id);
    const clientName = client.clientName ?? "OAuth client";

    const issued =
      body.grant_type === "authorization_code"
        ? await exchangeAuthorizationCode({
            code: body.code,
            clientId: body.client_id,
            redirectUri: body.redirect_uri,
            codeVerifier: body.code_verifier,
            resource: body.resource,
            clientName,
          })
        : await refreshTokens({
            refreshToken: body.refresh_token,
            clientId: body.client_id,
            resource: body.resource,
            clientName,
          });

    // Never cached: these are bearer credentials.
    c.header("Cache-Control", "no-store");
    return c.json({
      access_token: issued.accessToken,
      token_type: "Bearer",
      expires_in: issued.expiresInSeconds,
      refresh_token: issued.refreshToken,
      scope: issued.scopes.join(" "),
    });
  } catch (error) {
    if (error instanceof OAuthError) {
      return c.json(
        { error: error.code, error_description: error.message },
        400,
      );
    }
    if (error instanceof OAuthClientError) {
      return c.json(
        { error: "invalid_client", error_description: error.message },
        400,
      );
    }
    logger.error(formatError(error), "Token endpoint failed");
    return c.json(
      { error: "server_error", error_description: "Unexpected error" },
      500,
    );
  }
});
