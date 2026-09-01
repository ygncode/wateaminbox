/**
 * Authorization-code and token issuance for the MCP authorization server.
 *
 * Tokens are opaque and live in `api_tokens`, because the authorization server
 * is co-hosted with the resource server it protects: nothing outside this
 * service ever needs to verify a token without asking us, so a signed JWT would
 * buy nothing and cost a key-management layer. The consequence is that every
 * existing api_token behaviour - verification, scope filtering, revocation, the
 * per-token MCP rate limiter - applies to OAuth tokens unchanged.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@wateaminbox/database";
import type { Database } from "@wateaminbox/database";
import type { Transaction } from "kysely";
import type { ApiTokenScope } from "@wateaminbox/database";
import { toDbDate } from "@wateaminbox/shared";
import { API_TOKEN_PREFIX } from "./api-token.service.js";

/** Long enough to survive a slow consent screen, short enough to be useless if leaked. */
const AUTHORIZATION_CODE_TTL_MS = 5 * 60 * 1000;

const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export class OAuthError extends Error {
  constructor(
    /** An RFC 6749 error code; the wire format is `{ error, error_description }`. */
    readonly code:
      | "invalid_request"
      | "invalid_grant"
      | "invalid_client"
      | "invalid_scope"
      | "unauthorized_client"
      | "server_error",
    message: string,
  ) {
    super(message);
    this.name = "OAuthError";
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function randomSecret(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Parse a space-delimited scope request down to what a token can carry.
 *
 * `offline_access` is accepted and dropped: Claude appends it whenever the
 * authorization server advertises it, but it describes wanting a refresh token
 * rather than an access right, and `api_tokens.scopes` is constrained to
 * read/write. Read is always granted - a token that can do nothing is not worth
 * issuing, and `write` alone is not a valid combination.
 */
export function parseScopes(requested: string | undefined): ApiTokenScope[] {
  const parts = (requested ?? "").split(/\s+/).filter(Boolean);
  const wantsWrite = parts.includes("write");
  const unknown = parts.filter(
    (part) => !["read", "write", "offline_access"].includes(part),
  );
  if (unknown.length > 0) {
    throw new OAuthError("invalid_scope", `Unknown scope: ${unknown[0]}`);
  }
  return wantsWrite ? ["read", "write"] : ["read"];
}

export interface CreateAuthorizationCodeInput {
  clientId: string;
  userId: string;
  companyId: string;
  scopes: ApiTokenScope[];
  redirectUri: string;
  codeChallenge: string;
  resource: string;
}

/** Issue a single-use authorization code. The raw code is returned once. */
export async function createAuthorizationCode(
  input: CreateAuthorizationCodeInput,
): Promise<string> {
  const code = randomSecret();
  await db
    .insertInto("oauth_authorization_codes")
    .values({
      code_hash: sha256(code),
      client_id: input.clientId,
      user_id: input.userId,
      company_id: input.companyId,
      scopes: input.scopes,
      redirect_uri: input.redirectUri,
      code_challenge: input.codeChallenge,
      code_challenge_method: "S256",
      resource: input.resource,
      expires_at: new Date(Date.now() + AUTHORIZATION_CODE_TTL_MS),
    })
    .execute();
  return code;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  scopes: ApiTokenScope[];
}

/**
 * Mint an access/refresh pair against a grant.
 *
 * The access token is an ordinary `api_tokens` row carrying `grant_id`, so
 * `verifyApiToken` finds it with no changes.
 */
async function issueTokens(
  trx: Transaction<Database>,
  grantId: string,
  userId: string,
  companyId: string,
  scopes: ApiTokenScope[],
  clientName: string,
): Promise<IssuedTokens> {
  const accessToken = `${API_TOKEN_PREFIX}${randomSecret()}`;
  const refreshToken = `${API_TOKEN_PREFIX}${randomSecret()}`;
  const now = toDbDate();

  await trx
    .insertInto("api_tokens")
    .values({
      user_id: userId,
      company_id: companyId,
      name: clientName.slice(0, 100),
      token_hash: sha256(accessToken),
      token_prefix: accessToken.slice(0, 10),
      scopes,
      expires_at: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS),
      grant_id: grantId,
      refresh_token_hash: sha256(refreshToken),
      refresh_expires_at: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
    })
    .execute();

  return {
    accessToken,
    refreshToken,
    expiresInSeconds: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    scopes,
  };
}

/**
 * Verify a PKCE code verifier against the stored S256 challenge.
 *
 * Compared in constant time. The lengths are checked first because
 * timingSafeEqual throws on a length mismatch.
 */
function verifyPkce(verifier: string, challenge: string): boolean {
  const computed = createHash("sha256").update(verifier).digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Share-lock the membership behind a grant.
 *
 * Removal takes the same rows, so this serialises the two: if issuance wins,
 * removal waits and then revokes what was issued; if removal wins, issuance
 * fails. Without it a code approved before removal could be exchanged after,
 * minting a fresh grant and a refresh chain that survives until reinvitation.
 */
async function requireActiveMembership(
  trx: Transaction<Database>,
  companyId: string,
  userId: string,
): Promise<void> {
  const membership = await trx
    .selectFrom("company_members")
    .select("id")
    .where("company_id", "=", companyId)
    .where("user_id", "=", userId)
    .forShare()
    .executeTakeFirst();
  if (!membership) {
    throw new OAuthError(
      "invalid_grant",
      "Workspace membership is no longer active",
    );
  }
}

export interface ExchangeCodeInput {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  resource: string | undefined;
  clientName: string;
}

/**
 * Exchange an authorization code for tokens.
 *
 * The code is consumed inside the same transaction that reads it, so two
 * simultaneous exchanges cannot both succeed.
 */
export async function exchangeAuthorizationCode(
  input: ExchangeCodeInput,
): Promise<IssuedTokens> {
  const codeHash = sha256(input.code);

  return db.transaction().execute(async (trx) => {
    const row = await trx
      .selectFrom("oauth_authorization_codes")
      .selectAll()
      .where("code_hash", "=", codeHash)
      .forUpdate()
      .executeTakeFirst();
    if (!row) {
      throw new OAuthError("invalid_grant", "Unknown authorization code");
    }
    // A code presented twice is an attack signal rather than a retry.
    if (row.consumed_at) {
      throw new OAuthError("invalid_grant", "Authorization code already used");
    }
    if (row.expires_at <= new Date()) {
      throw new OAuthError("invalid_grant", "Authorization code has expired");
    }
    if (row.client_id !== input.clientId) {
      throw new OAuthError(
        "invalid_grant",
        "Authorization code was issued to another client",
      );
    }
    // OAuth 2.1 requires the redirect_uri to match the authorization request
    // exactly at the token endpoint.
    if (row.redirect_uri !== input.redirectUri) {
      throw new OAuthError(
        "invalid_grant",
        "redirect_uri does not match the authorization request",
      );
    }
    // RFC 8707: if a resource is sent it must be the one the code was bound to.
    if (input.resource !== undefined && input.resource !== row.resource) {
      throw new OAuthError(
        "invalid_grant",
        "resource does not match the authorization request",
      );
    }
    if (!verifyPkce(input.codeVerifier, row.code_challenge)) {
      throw new OAuthError("invalid_grant", "PKCE verification failed");
    }

    // Everything from here - the membership check, consuming the code, the
    // grant and the tokens - is one atomic unit. Approving before a removal and
    // exchanging after it would otherwise mint a working refresh chain for
    // someone who is no longer a member.
    await requireActiveMembership(trx, row.company_id, row.user_id);

    await trx
      .updateTable("oauth_authorization_codes")
      .set({ consumed_at: toDbDate() })
      .where("id", "=", row.id)
      .execute();

    const grant = await trx
      .insertInto("oauth_grants")
      .values({
        user_id: row.user_id,
        company_id: row.company_id,
        client_id: row.client_id,
        scopes: row.scopes,
        resource: row.resource,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    return issueTokens(
      trx,
      grant.id,
      row.user_id,
      row.company_id,
      row.scopes,
      input.clientName,
    );
  });
}

/** Revoke a grant and every token issued under it. */
export async function revokeGrant(
  grantId: string,
  reason: string,
): Promise<void> {
  const now = toDbDate();
  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable("oauth_grants")
      .set({ revoked_at: now, revoked_reason: reason })
      .where("id", "=", grantId)
      .where("revoked_at", "is", null)
      .execute();
    await trx
      .updateTable("api_tokens")
      .set({ revoked_at: now })
      .where("grant_id", "=", grantId)
      .where("revoked_at", "is", null)
      .execute();
  });
}

export interface RefreshInput {
  refreshToken: string;
  clientId: string;
  resource: string | undefined;
  clientName: string;
}

/**
 * Rotate a refresh token.
 *
 * Presenting a refresh token that has already been exchanged is the RFC 6819
 * reuse signal: it means the token leaked and both the attacker and the honest
 * client hold one. The whole grant is revoked rather than the single token, so
 * the attacker cannot keep the chain alive.
 */
export async function refreshTokens(
  input: RefreshInput,
): Promise<IssuedTokens> {
  const hash = sha256(input.refreshToken);

  const existing = await db
    .selectFrom("api_tokens")
    .innerJoin("oauth_grants", "oauth_grants.id", "api_tokens.grant_id")
    .select([
      "api_tokens.id as token_id",
      "api_tokens.user_id as user_id",
      "api_tokens.company_id as company_id",
      "api_tokens.revoked_at as token_revoked_at",
      "api_tokens.refresh_used_at as refresh_used_at",
      "api_tokens.refresh_expires_at as refresh_expires_at",
      "oauth_grants.id as grant_id",
      "oauth_grants.client_id as client_id",
      "oauth_grants.scopes as scopes",
      "oauth_grants.resource as resource",
      "oauth_grants.revoked_at as grant_revoked_at",
    ])
    .where("api_tokens.refresh_token_hash", "=", hash)
    .executeTakeFirst();

  if (!existing) {
    throw new OAuthError("invalid_grant", "Unknown refresh token");
  }
  if (existing.grant_revoked_at) {
    throw new OAuthError(
      "invalid_grant",
      "This authorization has been revoked",
    );
  }
  // Revoking the access-token row must stop its refresh token too. Anything
  // that revokes tokens without knowing about grants - membership removal, an
  // admin sweep - would otherwise be undone by the connector's next refresh.
  if (existing.token_revoked_at) {
    await revokeGrant(existing.grant_id, "token_revoked");
    throw new OAuthError("invalid_grant", "This token has been revoked");
  }
  if (existing.refresh_used_at) {
    await revokeGrant(existing.grant_id, "refresh_token_reuse");
    throw new OAuthError(
      "invalid_grant",
      "Refresh token has already been used; this authorization has been revoked",
    );
  }
  if (
    existing.refresh_expires_at &&
    existing.refresh_expires_at <= new Date()
  ) {
    throw new OAuthError("invalid_grant", "Refresh token has expired");
  }
  if (existing.client_id !== input.clientId) {
    throw new OAuthError(
      "invalid_grant",
      "Refresh token was issued to another client",
    );
  }
  if (input.resource !== undefined && input.resource !== existing.resource) {
    throw new OAuthError(
      "invalid_grant",
      "resource does not match this authorization",
    );
  }

  const rotated = await db.transaction().execute(async (trx) => {
    // Same reasoning as the code exchange: a refresh racing a membership
    // removal must not be able to extend the chain past the boundary.
    await requireActiveMembership(trx, existing.company_id, existing.user_id);

    // Claim the rotation. The guard on refresh_used_at makes two concurrent
    // refreshes resolve to one winner rather than two valid chains.
    const claimed = await trx
      .updateTable("api_tokens")
      .set({ refresh_used_at: toDbDate() })
      .where("id", "=", existing.token_id)
      .where("refresh_used_at", "is", null)
      .executeTakeFirst();
    if (!claimed || Number(claimed.numUpdatedRows) === 0) {
      return null;
    }

    await trx
      .updateTable("oauth_grants")
      .set({ last_used_at: toDbDate() })
      .where("id", "=", existing.grant_id)
      .execute();

    return issueTokens(
      trx,
      existing.grant_id,
      existing.user_id,
      existing.company_id,
      existing.scopes,
      input.clientName,
    );
  });

  // Losing the claim means another request already spent this refresh token,
  // which is the reuse signal. Revoking happens outside the rolled-back-free
  // path so it is not undone by the transaction that observed the loss.
  if (!rotated) {
    await revokeGrant(existing.grant_id, "refresh_token_reuse");
    throw new OAuthError(
      "invalid_grant",
      "Refresh token has already been used; this authorization has been revoked",
    );
  }
  return rotated;
}

export interface ConnectedApp {
  grantId: string;
  clientId: string;
  clientName: string | null;
  scopes: ApiTokenScope[];
  createdAt: Date;
  lastUsedAt: Date | null;
  /** Who authorized it. An admin seeing another member's grant needs to know whose it is. */
  ownerUserId: string;
  ownerName: string | null;
  /**
   * Whether the caller may disconnect this one. Computed here so the client
   * never re-derives the authorization rule and drifts from it.
   */
  canDisconnect: boolean;
}

/**
 * Connectors currently authorized against a workspace.
 *
 * Scoped to the caller unless they can see everything: a grant carries the
 * authorizing member's own access, so listing another member's connectors is
 * the same disclosure as listing their tokens.
 */
export async function listConnectedApps(
  companyId: string,
  options: { requesterId: string; isAdmin: boolean },
): Promise<ConnectedApp[]> {
  let query = db
    .selectFrom("oauth_grants")
    .leftJoin(
      "oauth_clients",
      "oauth_clients.client_id",
      "oauth_grants.client_id",
    )
    .leftJoin("users", "users.id", "oauth_grants.user_id")
    .select([
      "oauth_grants.id as id",
      "oauth_grants.user_id as user_id",
      "oauth_grants.client_id as client_id",
      "oauth_clients.client_name as client_name",
      "users.name as owner_name",
      "users.email as owner_email",
      "oauth_grants.scopes as scopes",
      "oauth_grants.created_at as created_at",
      "oauth_grants.last_used_at as last_used_at",
    ])
    .where("oauth_grants.company_id", "=", companyId)
    .where("oauth_grants.revoked_at", "is", null)
    .orderBy("oauth_grants.created_at", "desc");
  // Visibility follows the same rule as revocation - workspace role, not
  // can_view_all_chats. A grant is a credential rather than a conversation, and
  // scoping the two differently let a member see connectors they could not
  // disconnect.
  if (!options.isAdmin) {
    query = query.where("oauth_grants.user_id", "=", options.requesterId);
  }
  const rows = await query.execute();
  return rows.map((row) => ({
    grantId: row.id,
    clientId: row.client_id,
    clientName: row.client_name,
    scopes: row.scopes,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    ownerUserId: row.user_id,
    ownerName: row.owner_name ?? row.owner_email ?? null,
    canDisconnect: options.isAdmin || row.user_id === options.requesterId,
  }));
}

/**
 * Disconnect a connector. Returns false when the grant is not visible to the
 * requester, which is deliberately indistinguishable from it not existing.
 */
export async function revokeConnectedApp(input: {
  grantId: string;
  companyId: string;
  requesterId: string;
  isAdmin: boolean;
}): Promise<boolean> {
  let query = db
    .selectFrom("oauth_grants")
    .select("id")
    .where("id", "=", input.grantId)
    .where("company_id", "=", input.companyId)
    .where("revoked_at", "is", null);
  if (!input.isAdmin) {
    query = query.where("user_id", "=", input.requesterId);
  }
  const grant = await query.executeTakeFirst();
  if (!grant) return false;

  await revokeGrant(grant.id, "user_revoked");
  return true;
}
