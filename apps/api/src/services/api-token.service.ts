import { createHash, randomBytes } from "node:crypto";
import { db, type ApiTokenScope } from "@wateaminbox/database";
import { ForbiddenError } from "../lib/errors.js";

export const API_TOKEN_PREFIX = "wti_";
const TOKEN_RANDOM_LENGTH = 40;
const DISPLAY_PREFIX_LENGTH = 10;
/** Skip last_used_at writes when the stored value is fresher than this. */
const LAST_USED_UPDATE_INTERVAL_MS = 60_000;

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export interface ApiTokenSummary {
  id: string;
  userId: string;
  companyId: string;
  name: string;
  tokenPrefix: string;
  scopes: ApiTokenScope[];
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface VerifiedApiToken {
  id: string;
  userId: string;
  companyId: string;
  scopes: ApiTokenScope[];
  /**
   * For an OAuth-issued token, the RFC 8707 resource its grant was bound to.
   * Null for a hand-made personal token, which is not audience-scoped because
   * a person created it for this server directly.
   */
  resource: string | null;
}

export function hashApiToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function generateApiToken(): {
  token: string;
  hash: string;
  prefix: string;
} {
  const bytes = randomBytes(TOKEN_RANDOM_LENGTH);
  let random = "";
  for (let i = 0; i < TOKEN_RANDOM_LENGTH; i++) {
    random += BASE62[bytes[i]! % BASE62.length];
  }
  const token = `${API_TOKEN_PREFIX}${random}`;
  return {
    token,
    hash: hashApiToken(token),
    prefix: token.slice(0, DISPLAY_PREFIX_LENGTH),
  };
}

function toSummary(row: {
  id: string;
  user_id: string;
  company_id: string;
  name: string;
  token_prefix: string;
  scopes: ApiTokenScope[];
  last_used_at: Date | null;
  expires_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}): ApiTokenSummary {
  return {
    id: row.id,
    userId: row.user_id,
    companyId: row.company_id,
    name: row.name,
    tokenPrefix: row.token_prefix,
    scopes: row.scopes,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}

export async function createApiToken(input: {
  userId: string;
  companyId: string;
  name: string;
  scopes: ApiTokenScope[];
  expiresAt?: Date | null;
}): Promise<{ token: string; summary: ApiTokenSummary }> {
  const { token, hash, prefix } = generateApiToken();
  const row = await db.transaction().execute(async (trx) => {
    // Share-lock the membership so removal cannot race this insert. If token
    // creation wins, removal waits and revokes it; if removal wins, this fails.
    const membership = await trx
      .selectFrom("company_members")
      .select("id")
      .where("company_id", "=", input.companyId)
      .where("user_id", "=", input.userId)
      .forShare()
      .executeTakeFirst();
    if (!membership) {
      throw new ForbiddenError("Workspace membership is no longer active");
    }

    return trx
      .insertInto("api_tokens")
      .values({
        user_id: input.userId,
        company_id: input.companyId,
        name: input.name,
        token_hash: hash,
        token_prefix: prefix,
        scopes: input.scopes,
        expires_at: input.expiresAt ?? null,
        last_used_at: null,
        revoked_at: null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  });
  return { token, summary: toSummary(row) };
}

export async function listApiTokens(
  companyId: string,
  options: { userId?: string } = {},
): Promise<ApiTokenSummary[]> {
  let query = db
    .selectFrom("api_tokens")
    .selectAll()
    .where("company_id", "=", companyId)
    .orderBy("created_at", "desc");
  if (options.userId) {
    query = query.where("user_id", "=", options.userId);
  }
  const rows = await query.execute();
  return rows.map(toSummary);
}

/**
 * Revokes a token. Non-admin requesters may only revoke their own tokens.
 * Returns the revoked token, or null when not found / not permitted
 * (indistinguishable to avoid leaking other members' token ids).
 */
export async function revokeApiToken(input: {
  tokenId: string;
  companyId: string;
  requesterId: string;
  isAdmin: boolean;
}): Promise<ApiTokenSummary | null> {
  let query = db
    .updateTable("api_tokens")
    .set({ revoked_at: new Date() })
    .where("id", "=", input.tokenId)
    .where("company_id", "=", input.companyId)
    .where("revoked_at", "is", null);
  if (!input.isAdmin) {
    query = query.where("user_id", "=", input.requesterId);
  }
  const row = await query.returningAll().executeTakeFirst();
  return row ? toSummary(row) : null;
}

/**
 * Verifies a raw bearer token. Returns null for unknown, revoked, or
 * expired tokens. Updates last_used_at at most once per interval,
 * fire-and-forget.
 */
export async function verifyApiToken(
  rawToken: string,
): Promise<VerifiedApiToken | null> {
  if (!rawToken.startsWith(API_TOKEN_PREFIX)) {
    return null;
  }
  const row = await db
    .selectFrom("api_tokens")
    .leftJoin("oauth_grants", "oauth_grants.id", "api_tokens.grant_id")
    .selectAll("api_tokens")
    .select([
      "oauth_grants.resource as grant_resource",
      "oauth_grants.revoked_at as grant_revoked_at",
    ])
    .where("api_tokens.token_hash", "=", hashApiToken(rawToken))
    .executeTakeFirst();
  if (!row || row.revoked_at) {
    return null;
  }
  // Revoking a grant marks its tokens too, but check the grant as well so a
  // token can never outlive the authorization it came from.
  if (row.grant_revoked_at) {
    return null;
  }
  if (row.expires_at && row.expires_at.getTime() <= Date.now()) {
    return null;
  }

  const lastUsed = row.last_used_at?.getTime() ?? 0;
  if (Date.now() - lastUsed > LAST_USED_UPDATE_INTERVAL_MS) {
    db.updateTable("api_tokens")
      .set({ last_used_at: new Date() })
      .where("id", "=", row.id)
      .execute()
      .catch(() => {});
  }

  return {
    id: row.id,
    userId: row.user_id,
    companyId: row.company_id,
    scopes: row.scopes,
    resource: row.grant_resource ?? null,
  };
}
