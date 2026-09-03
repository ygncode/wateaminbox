/**
 * OAuth discovery documents.
 *
 * These are the only routes served outside the `/api` prefix, because the paths
 * are fixed by RFC 8414 and RFC 9728 and clients will not look anywhere else.
 * That also means the edge has to forward them: Caddy only proxies `/api/*`, so
 * without a matching rule these fall through to the SPA and answer 200 with
 * HTML, which looks like success to a client and fails confusingly.
 */

import { Hono } from "hono";
import { env } from "../lib/env.js";
import { canonicalResource, issuer } from "./oauth.js";

export const wellKnownRoutes = new Hono();

/**
 * Cache briefly. Clients fetch these on every fresh connection, but a stale
 * document survives long past a config change, so minutes rather than hours.
 */
const CACHE_CONTROL = "public, max-age=300";

function authorizationServerMetadata() {
  return {
    issuer: issuer(),
    authorization_endpoint: `${issuer()}/api/oauth/authorize`,
    token_endpoint: `${issuer()}/api/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    // OAuth 2.1 requires PKCE and the MCP spec requires S256 specifically.
    // A client that cannot see S256 here treats the server as unsupported.
    code_challenge_methods_supported: ["S256"],
    // These two fields together are what select CIMD. Claude checks for both
    // and silently falls back to Dynamic Client Registration if either is
    // missing - which this server does not implement, so the connection would
    // fail rather than degrade.
    token_endpoint_auth_methods_supported: ["none"],
    client_id_metadata_document_supported: true,
    // offline_access is advertised so Claude asks for a refresh token. It is
    // dropped when the grant is stored; see parseScopes.
    scopes_supported: ["read", "write", "offline_access"],
    // RFC 9207: we return `iss` on the authorization response, which lets a
    // client detect a mix-up between authorization servers.
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${env.APP_URL.replace(/\/$/, "")}/settings/api-tokens`,
  };
}

function protectedResourceMetadata() {
  return {
    resource: canonicalResource(),
    authorization_servers: [issuer()],
    scopes_supported: ["read", "write"],
    bearer_methods_supported: ["header"],
  };
}

wellKnownRoutes.get("/oauth-authorization-server", (c) => {
  c.header("Cache-Control", CACHE_CONTROL);
  return c.json(authorizationServerMetadata());
});

/**
 * RFC 9728 defines two locations and clients probe both: the path-inserted form
 * first, then the root. `/api/mcp` is the resource path, so the path-inserted
 * URL is `/.well-known/oauth-protected-resource/api/mcp`.
 */
wellKnownRoutes.get("/oauth-protected-resource", (c) => {
  c.header("Cache-Control", CACHE_CONTROL);
  return c.json(protectedResourceMetadata());
});

wellKnownRoutes.get("/oauth-protected-resource/*", (c) => {
  c.header("Cache-Control", CACHE_CONTROL);
  return c.json(protectedResourceMetadata());
});
