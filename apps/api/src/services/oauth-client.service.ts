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

import type { LookupAddress } from "node:dns";
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
 * Every address a hostname resolves to, once all of them are known to be public.
 *
 * All are returned rather than one because the caller has to be able to fall
 * back. Pinning to a single address removes the fallback that ordinary
 * resolution performs, and this host has no IPv6 route: handing back an
 * AAAA record produced ECONNREFUSED for every client, while a plain fetch
 * to the same name worked. IPv4 is tried first for that reason.
 *
 * The addresses are dialled directly rather than installed as the request's
 * `lookup` option. Bun cannot use one - the documented array form fails to
 * connect and the single-address form crashes inside Bun with
 * "results.sort is not a function" - and dialling directly pins just as well.
 */
async function resolveSafeAddresses(
  hostname: string,
): Promise<Array<{ address: string; family: number }>> {
  const bare = hostname.replace(/^\[|\]$/g, "");
  if (isIP(bare)) {
    if (isPrivateAddress(bare)) {
      throw new OAuthClientError(
        "client_id must not point at a private address",
      );
    }
    return [{ address: bare, family: isIP(bare) }];
  }

  let entries: LookupAddress[];
  try {
    entries = await lookup(bare, { all: true });
  } catch {
    throw new OAuthClientError(`Could not resolve ${bare}`, "unreachable");
  }
  if (entries.length === 0) {
    throw new OAuthClientError(`Could not resolve ${bare}`, "unreachable");
  }
  // Every answer must be public. Filtering to the safe ones would let a name
  // resolving to both a public and a private address through.
  if (entries.some((entry) => isPrivateAddress(entry.address))) {
    throw new OAuthClientError("client_id must not point at a private address");
  }
  return [
    ...entries.filter((e) => e.family === 4),
    ...entries.filter((e) => e.family !== 4),
  ].map((e) => ({ address: e.address, family: e.family }));
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

/** One attempt against one already-validated address. */
async function fetchFromAddress(
  url: URL,
  pinned: { address: string; family: number },
  deadlineAt: number,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // An absolute deadline, not the socket's inactivity timeout. `timeout` on
    // an https request only fires after a quiet period, so a host that trickles
    // one byte at a time keeps the request alive forever; it also does not
    // cover DNS resolution. This clock starts before the lookup and ends the
    // request wherever it has got to.
    let settled = false;
    const deadline = setTimeout(
      () => {
        if (settled) return;
        settled = true;
        request.destroy();
        reject(
          new OAuthClientError("Client metadata timed out", "unreachable"),
        );
      },
      Math.max(1, deadlineAt - Date.now()),
    );

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
        // The validated address, so nothing re-resolves between the check and
        // the connection.
        hostname: pinned.family === 6 ? `[${pinned.address}]` : pinned.address,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        // Host carries the real name so the server routes correctly, and
        // servername does the same for SNI and certificate validation - the
        // certificate is still checked against the hostname, not the IP.
        headers: { accept: "application/json", host: url.host },
        servername: url.hostname,
        timeout: FETCH_TIMEOUT_MS,
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
 * Fetch the document, trying each validated address in turn.
 *
 * Falling back matters because pinning removes the fallback ordinary
 * resolution does for us: an AAAA record on a host with no IPv6 route would
 * otherwise fail the request outright rather than moving to the A record.
 * The deadline spans all attempts, so a slow host cannot buy extra time by
 * having several addresses.
 */
async function fetchDocument(url: URL): Promise<unknown> {
  const addresses = await resolveSafeAddresses(url.hostname);
  const deadlineAt = Date.now() + FETCH_TIMEOUT_MS;

  let lastError: unknown;
  for (const pinned of addresses) {
    if (Date.now() >= deadlineAt) break;
    try {
      return await fetchFromAddress(url, pinned, deadlineAt);
    } catch (error) {
      // A bad document is the server's answer, not a reachability problem;
      // another address would return the same thing.
      if (
        error instanceof OAuthClientError &&
        error.code === "invalid_document"
      ) {
        throw error;
      }
      lastError = error;
    }
  }
  throw (
    lastError ??
    new OAuthClientError("Could not fetch client metadata", "unreachable")
  );
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
