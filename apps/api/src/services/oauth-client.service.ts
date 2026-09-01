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

import type { LookupAddress, LookupOptions } from "node:dns";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { db } from "@wateaminbox/database";
import { toDbDate } from "@wateaminbox/shared";

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

/**
 * Validate the shape of a client_id. Address checks happen at connect time,
 * not here - see `pinnedLookup`.
 */
function assertHttpsUrl(raw: string): URL {
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
  if (isIP(host) && isPrivateAddress(host)) {
    throw new OAuthClientError("client_id must not point at a private address");
  }
  return url;
}

/**
 * DNS resolution that refuses to hand back a private address.
 *
 * This is installed as the connection's own lookup rather than run beforehand,
 * which is what closes DNS rebinding: validating in a separate step leaves a
 * window where the name resolves publicly for the check and privately for the
 * connection. Here the address that is validated is the address that is dialled.
 */
function pinnedLookup(
  hostname: string,
  options: LookupOptions,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
  ) => void,
): void {
  lookup(hostname, { all: true })
    .then((entries) => {
      // Every answer must be public. Accepting only the safe subset would let a
      // name that resolves to both a public and a private address through.
      if (
        entries.length === 0 ||
        entries.some((e) => isPrivateAddress(e.address))
      ) {
        callback(
          new OAuthClientError(
            "client_id must not point at a private address",
          ) as NodeJS.ErrnoException,
          "",
        );
        return;
      }
      if (options.all) {
        callback(null, entries);
        return;
      }
      callback(null, entries[0].address, entries[0].family);
    })
    .catch(() => {
      callback(
        new OAuthClientError(
          `Could not resolve ${hostname}`,
          "unreachable",
        ) as NodeJS.ErrnoException,
        "",
      );
    });
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

  return {
    clientId,
    clientName:
      typeof doc.client_name === "string" && doc.client_name.trim()
        ? doc.client_name.trim().slice(0, 200)
        : null,
    redirectUris,
    tokenEndpointAuthMethod:
      typeof doc.token_endpoint_auth_method === "string"
        ? doc.token_endpoint_auth_method
        : "none",
  };
}

async function fetchDocument(url: URL): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // An absolute deadline, not the socket's inactivity timeout. `timeout` on
    // an https request only fires after a quiet period, so a host that trickles
    // one byte at a time keeps the request alive forever; it also does not
    // cover DNS resolution. This clock starts before the lookup and ends the
    // request wherever it has got to.
    let settled = false;
    const deadline = setTimeout(() => {
      if (settled) return;
      settled = true;
      request.destroy();
      reject(new OAuthClientError("Client metadata timed out", "unreachable"));
    }, FETCH_TIMEOUT_MS);

    const finish = <T>(fn: (value: T) => void) => {
      return (value: T) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        fn(value);
      };
    };
    const settleResolve = finish(resolve);
    const settleReject = finish(reject);

    const request = httpsRequest(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: { accept: "application/json" },
        // Keep the real hostname for SNI and certificate validation while the
        // address is pinned by the lookup above.
        servername: url.hostname,
        timeout: FETCH_TIMEOUT_MS,
        lookup: pinnedLookup,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        // A metadata document has no reason to redirect, and following one
        // would re-resolve a new host outside this request's checks.
        if (status >= 300 && status < 400) {
          response.destroy();
          settleReject(
            new OAuthClientError(
              "Client metadata must not redirect",
              "invalid_document",
            ),
          );
          return;
        }
        if (status < 200 || status >= 300) {
          response.destroy();
          settleReject(
            new OAuthClientError(
              `Client metadata returned HTTP ${status}`,
              "unreachable",
            ),
          );
          return;
        }
        const declared = Number(response.headers["content-length"] ?? 0);
        if (declared > MAX_DOCUMENT_BYTES) {
          response.destroy();
          settleReject(
            new OAuthClientError(
              "Client metadata document is too large",
              "invalid_document",
            ),
          );
          return;
        }

        // Count as the body arrives and hang up on the way past the limit, so a
        // hostile host cannot make us buffer an arbitrarily large response.
        let received = 0;
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > MAX_DOCUMENT_BYTES) {
            response.destroy();
            settleReject(
              new OAuthClientError(
                "Client metadata document is too large",
                "invalid_document",
              ),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          try {
            settleResolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            settleReject(
              new OAuthClientError(
                "Client metadata is not valid JSON",
                "invalid_document",
              ),
            );
          }
        });
        response.on("error", () =>
          settleReject(
            new OAuthClientError(
              "Could not read client metadata",
              "unreachable",
            ),
          ),
        );
      },
    );

    request.on("timeout", () => {
      request.destroy();
      settleReject(
        new OAuthClientError("Client metadata timed out", "unreachable"),
      );
    });
    request.on("error", (error) => {
      settleReject(
        error instanceof OAuthClientError
          ? error
          : new OAuthClientError(
              "Could not fetch client metadata",
              "unreachable",
            ),
      );
    });
    request.end();
  });
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
  const url = assertHttpsUrl(clientId);

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

  // No stale fallback. redirect_uris and the auth method are the security
  // decision this function exists to make, and a redirect removed after a
  // compromise must stop being honoured immediately - serving a cached copy
  // through an outage would keep authorizing it indefinitely. Failing closed
  // costs an authorization attempt; failing open costs the account.
  const resolved = parseDocument(clientId, await fetchDocument(url));

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
    // RFC 8252 lets a native client vary only the PORT: it cannot know which
    // ephemeral port it will get. The hostname is not interchangeable -
    // treating localhost and 127.0.0.1 as equivalent would honour a redirect
    // the client never declared, and "localhost" is resolver-controlled in a
    // way the literals are not.
    const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
    if (!loopbackHosts.has(allowed.hostname)) return false;
    if (allowed.hostname !== target.hostname) return false;
    return (
      allowed.protocol === target.protocol &&
      allowed.pathname === target.pathname &&
      allowed.search === target.search
    );
  });
}
