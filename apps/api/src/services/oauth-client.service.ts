/**
 * Client identity for the MCP authorization server, via client ID metadata
 * documents (CIMD).
 *
 * A client identifies itself with the https URL of its metadata document and we
 * fetch that document, rather than the client registering with us. Dynamic
 * Client Registration is deliberately not implemented: the 2026-07-28 MCP spec
 * deprecates it, and Anthropic reports that it makes Claude register a fresh
 * client on every new connection.
 *
 * Fetching a URL chosen by the caller is server-side request forgery unless it
 * is constrained, so `assertPublicHttpsUrl` runs before every request and
 * redirects are refused outright.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { db } from "@wateaminbox/database";
import { toDbDate } from "@wateaminbox/shared";
import { createLogger, formatError } from "../lib/logger.js";

const logger = createLogger("OAuthClient");

/** Vendors time discovery out at 10s; stay well inside that. */
const FETCH_TIMEOUT_MS = 5_000;

/** A metadata document is small; anything larger is not one. */
const MAX_DOCUMENT_BYTES = 64 * 1024;

/** Refetch after this so a client can rotate its redirect URIs. */
const CACHE_TTL_MS = 60 * 60 * 1000;

export class OAuthClientError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid_client_id"
      | "unreachable"
      | "invalid_document" = "invalid_client_id",
  ) {
    super(message);
    this.name = "OAuthClientError";
  }
}

export interface ResolvedOAuthClient {
  clientId: string;
  clientName: string | null;
  redirectUris: string[];
  tokenEndpointAuthMethod: string;
}

/**
 * True for addresses that must never be fetched: loopback, private ranges,
 * link-local (which covers the 169.254.169.254 cloud metadata endpoint),
 * carrier-grade NAT, and the IPv6 equivalents.
 */
function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const parts = address.split(".").map(Number);
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (version === 6) {
    const lower = address.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    // Unique-local (fc00::/7) and link-local (fe80::/10).
    if (/^f[cd]/.test(lower)) return true;
    if (/^fe[89ab]/.test(lower)) return true;
    // IPv4-mapped addresses must be judged on the embedded IPv4 address, or
    // ::ffff:127.0.0.1 walks straight through this check. Both spellings have
    // to be handled: the WHATWG URL parser normalises the dotted form to hex,
    // so `https://[::ffff:127.0.0.1]/` reaches here as `::ffff:7f00:1`.
    const mappedDotted = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mappedDotted) return isPrivateAddress(mappedDotted[1]);
    const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const high = Number.parseInt(mappedHex[1], 16);
      const low = Number.parseInt(mappedHex[2], 16);
      return isPrivateAddress(
        `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`,
      );
    }
    return false;
  }
  return false;
}

async function assertPublicHttpsUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OAuthClientError("client_id must be an absolute URL");
  }
  if (url.protocol !== "https:") {
    throw new OAuthClientError("client_id must use https");
  }
  if (url.hash) {
    throw new OAuthClientError("client_id must not contain a fragment");
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (isPrivateAddress(host)) {
      throw new OAuthClientError(
        "client_id must not point at a private address",
      );
    }
    return url;
  }

  let resolved: Array<{ address: string }>;
  try {
    resolved = await lookup(host, { all: true });
  } catch {
    throw new OAuthClientError(`Could not resolve ${host}`, "unreachable");
  }
  // Every answer must be public: one private record is enough to abuse.
  if (resolved.some((entry) => isPrivateAddress(entry.address))) {
    throw new OAuthClientError("client_id must not point at a private address");
  }
  return url;
}

function parseDocument(clientId: string, raw: unknown): ResolvedOAuthClient {
  if (!raw || typeof raw !== "object") {
    throw new OAuthClientError(
      "Client metadata is not an object",
      "invalid_document",
    );
  }
  const doc = raw as Record<string, unknown>;

  // The document must claim the same identity as the URL it was fetched from,
  // or any hosted JSON file could impersonate another client.
  if (doc.client_id !== clientId) {
    throw new OAuthClientError(
      "Client metadata client_id does not match its URL",
      "invalid_document",
    );
  }

  const redirectUris = Array.isArray(doc.redirect_uris)
    ? doc.redirect_uris.filter((uri): uri is string => typeof uri === "string")
    : [];
  if (redirectUris.length === 0) {
    throw new OAuthClientError(
      "Client metadata declares no redirect_uris",
      "invalid_document",
    );
  }

  const authMethod =
    typeof doc.token_endpoint_auth_method === "string"
      ? doc.token_endpoint_auth_method
      : "none";

  return {
    clientId,
    clientName:
      typeof doc.client_name === "string" && doc.client_name.trim()
        ? doc.client_name.trim().slice(0, 200)
        : null,
    redirectUris,
    tokenEndpointAuthMethod: authMethod,
  };
}

async function fetchDocument(url: URL): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      // A metadata document has no reason to redirect, and following one would
      // step outside the address check already performed.
      redirect: "error",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new OAuthClientError(
        `Client metadata returned HTTP ${response.status}`,
        "unreachable",
      );
    }
    const body = await response.text();
    if (body.length > MAX_DOCUMENT_BYTES) {
      throw new OAuthClientError(
        "Client metadata document is too large",
        "invalid_document",
      );
    }
    try {
      return JSON.parse(body);
    } catch {
      throw new OAuthClientError(
        "Client metadata is not valid JSON",
        "invalid_document",
      );
    }
  } catch (error) {
    if (error instanceof OAuthClientError) throw error;
    throw new OAuthClientError(
      "Could not fetch client metadata",
      "unreachable",
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve a client_id to its metadata, from cache when fresh.
 *
 * A stale cache entry is preferred over a hard failure when the fetch breaks:
 * a client that worked a minute ago should not stop working because its
 * document host had a blip mid-authorization.
 */
export async function resolveOAuthClient(
  clientId: string,
): Promise<ResolvedOAuthClient> {
  // Validate the identifier before touching storage: a malformed or private
  // client_id is rejected without costing a query, and nothing unvalidated is
  // ever used as a cache key.
  const url = await assertPublicHttpsUrl(clientId);

  const cached = await db
    .selectFrom("oauth_clients")
    .select([
      "client_id",
      "client_name",
      "redirect_uris",
      "token_endpoint_auth_method",
      "cache_expires_at",
    ])
    .where("client_id", "=", clientId)
    .executeTakeFirst();

  if (cached && cached.cache_expires_at > new Date()) {
    return {
      clientId: cached.client_id,
      clientName: cached.client_name,
      redirectUris: cached.redirect_uris,
      tokenEndpointAuthMethod: cached.token_endpoint_auth_method,
    };
  }

  let resolved: ResolvedOAuthClient;
  try {
    resolved = parseDocument(clientId, await fetchDocument(url));
  } catch (error) {
    if (cached) {
      logger.warn(
        { clientId, ...formatError(error) },
        "Client metadata refresh failed; serving the cached document",
      );
      return {
        clientId: cached.client_id,
        clientName: cached.client_name,
        redirectUris: cached.redirect_uris,
        tokenEndpointAuthMethod: cached.token_endpoint_auth_method,
      };
    }
    throw error;
  }

  const now = toDbDate();
  await db
    .insertInto("oauth_clients")
    .values({
      client_id: resolved.clientId,
      client_name: resolved.clientName,
      redirect_uris: resolved.redirectUris,
      token_endpoint_auth_method: resolved.tokenEndpointAuthMethod,
      metadata: JSON.stringify({
        client_id: resolved.clientId,
        client_name: resolved.clientName,
        redirect_uris: resolved.redirectUris,
        token_endpoint_auth_method: resolved.tokenEndpointAuthMethod,
      }),
      fetched_at: now,
      cache_expires_at: new Date(now.getTime() + CACHE_TTL_MS),
    })
    .onConflict((oc) =>
      oc.column("client_id").doUpdateSet({
        client_name: resolved.clientName,
        redirect_uris: resolved.redirectUris,
        token_endpoint_auth_method: resolved.tokenEndpointAuthMethod,
        fetched_at: now,
        cache_expires_at: new Date(now.getTime() + CACHE_TTL_MS),
      }),
    )
    .execute();

  return resolved;
}

/**
 * Whether a redirect URI is one the client declared.
 *
 * Exact string match, with one exception required by RFC 8252: a native client
 * listening on loopback cannot know its port in advance. Claude Code declares
 * `http://localhost/callback` and `http://127.0.0.1/callback` and then calls
 * back on an ephemeral port, so loopback comparisons ignore the port. Nothing
 * else is relaxed - host, scheme and path must still match exactly.
 */
export function isAllowedRedirectUri(
  client: ResolvedOAuthClient,
  candidate: string,
): boolean {
  let target: URL;
  try {
    target = new URL(candidate);
  } catch {
    return false;
  }
  if (target.hash) return false;

  return client.redirectUris.some((declared) => {
    if (declared === candidate) return true;
    let allowed: URL;
    try {
      allowed = new URL(declared);
    } catch {
      return false;
    }
    const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
    const bothLoopback =
      loopbackHosts.has(allowed.hostname) && loopbackHosts.has(target.hostname);
    if (!bothLoopback) return false;
    return (
      allowed.protocol === target.protocol &&
      allowed.pathname === target.pathname &&
      allowed.search === target.search
    );
  });
}
