import { type Kysely, sql } from "kysely";

/**
 * Storage for the OAuth 2.1 authorization server that fronts the MCP endpoint.
 *
 * The MCP server is a resource server that happens to co-host its authorization
 * server, so access tokens stay opaque and reuse `api_tokens` rather than
 * becoming signed JWTs: there is no second party who needs to verify them
 * without asking us.
 *
 * Three pieces:
 *
 *  - `oauth_clients` caches client metadata documents (CIMD). Clients identify
 *    themselves by a URL and we fetch the document from it; Dynamic Client
 *    Registration is deliberately not implemented, being deprecated in the
 *    2026-07-28 spec and discouraged by Anthropic.
 *  - `oauth_authorization_codes` holds single-use codes with their PKCE
 *    challenge between /authorize and /token.
 *  - `oauth_grants` is one authorization decision by one user. Access and
 *    refresh tokens hang off it in `api_tokens`, so revoking the grant kills
 *    every token in the rotation chain at once.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("oauth_clients")
    .ifNotExists()
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    // The CIMD URL the client presented as its client_id.
    .addColumn("client_id", "text", (col) => col.unique().notNull())
    .addColumn("client_name", "text")
    .addColumn("redirect_uris", sql`text[]`, (col) => col.notNull())
    .addColumn("token_endpoint_auth_method", "text", (col) =>
      col.defaultTo("none").notNull(),
    )
    // The document as fetched, kept for debugging vendor interop.
    .addColumn("metadata", "jsonb", (col) => col.notNull())
    .addColumn("fetched_at", "timestamptz", (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    // Refetch after this; a client can change its redirect URIs.
    .addColumn("cache_expires_at", "timestamptz", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .addCheckConstraint(
      "oauth_clients_client_id_https_check",
      // A client_id is a URL we will fetch, so it must be https. Refusing this
      // at the column keeps a plaintext or file: URL from ever being stored.
      sql`client_id LIKE 'https://%'`,
    )
    .addCheckConstraint(
      "oauth_clients_redirect_uris_check",
      sql`cardinality(redirect_uris) > 0`,
    )
    .execute();

  await db.schema
    .createTable("oauth_grants")
    .ifNotExists()
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("user_id", "uuid", (col) =>
      col.references("users.id").onDelete("cascade").notNull(),
    )
    // The workspace the user chose at the consent screen. A grant is bound to
    // one workspace for the same reason an api_token is.
    .addColumn("company_id", "uuid", (col) =>
      col.references("companies.id").onDelete("cascade").notNull(),
    )
    .addColumn("client_id", "text", (col) =>
      col.references("oauth_clients.client_id").onDelete("cascade").notNull(),
    )
    .addColumn("scopes", sql`text[]`, (col) => col.notNull())
    // RFC 8707: the resource this grant's tokens are audience-bound to. The MCP
    // endpoint rejects any token whose resource is not itself.
    .addColumn("resource", "text", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .addColumn("last_used_at", "timestamptz")
    // Set when the user revokes the connector, or when refresh-token reuse is
    // detected and the whole chain is burned.
    .addColumn("revoked_at", "timestamptz")
    .addColumn("revoked_reason", "text")
    .addCheckConstraint(
      "oauth_grants_scopes_check",
      sql`scopes <@ ARRAY['read', 'write']::text[]
        AND scopes @> ARRAY['read']::text[]
        AND cardinality(scopes) BETWEEN 1 AND 2`,
    )
    .execute();

  await db.schema
    .createIndex("oauth_grants_user_company_idx")
    .ifNotExists()
    .on("oauth_grants")
    .columns(["user_id", "company_id"])
    .execute();

  await db.schema
    .createIndex("oauth_grants_company_idx")
    .ifNotExists()
    .on("oauth_grants")
    .column("company_id")
    .execute();

  await db.schema
    .createTable("oauth_authorization_codes")
    .ifNotExists()
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    // sha256 of the code, never the code itself - same treatment as api_tokens.
    .addColumn("code_hash", "varchar(64)", (col) => col.unique().notNull())
    .addColumn("client_id", "text", (col) =>
      col.references("oauth_clients.client_id").onDelete("cascade").notNull(),
    )
    .addColumn("user_id", "uuid", (col) =>
      col.references("users.id").onDelete("cascade").notNull(),
    )
    .addColumn("company_id", "uuid", (col) =>
      col.references("companies.id").onDelete("cascade").notNull(),
    )
    .addColumn("scopes", sql`text[]`, (col) => col.notNull())
    // Echoed back at /token and compared exactly, per OAuth 2.1.
    .addColumn("redirect_uri", "text", (col) => col.notNull())
    .addColumn("code_challenge", "text", (col) => col.notNull())
    .addColumn("code_challenge_method", "text", (col) => col.notNull())
    .addColumn("resource", "text", (col) => col.notNull())
    .addColumn("expires_at", "timestamptz", (col) => col.notNull())
    // Single use. A second presentation is an attack signal, not a retry.
    .addColumn("consumed_at", "timestamptz")
    .addColumn("created_at", "timestamptz", (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .addCheckConstraint(
      "oauth_authorization_codes_pkce_check",
      // OAuth 2.1 requires PKCE and the MCP spec requires S256 specifically.
      // "plain" is not accepted at any layer, so reject it at the column.
      sql`code_challenge_method = 'S256'`,
    )
    .execute();

  await db.schema
    .createIndex("oauth_authorization_codes_expires_idx")
    .ifNotExists()
    .on("oauth_authorization_codes")
    .column("expires_at")
    .execute();

  // Access and refresh tokens live in api_tokens so that verification, scope
  // filtering, revocation and the per-token MCP rate limiter all keep working
  // unchanged. A row with a null grant_id is a hand-made personal token.
  await db.schema
    .alterTable("api_tokens")
    .addColumn("grant_id", "uuid", (col) =>
      col.references("oauth_grants.id").onDelete("cascade"),
    )
    .execute();

  await db.schema
    .alterTable("api_tokens")
    .addColumn("refresh_token_hash", "varchar(64)")
    .execute();

  await db.schema
    .alterTable("api_tokens")
    .addColumn("refresh_expires_at", "timestamptz")
    .execute();

  // Set the moment a refresh token is exchanged. Presenting an already-used
  // refresh token is the RFC 6819 reuse signal and burns the whole grant.
  await db.schema
    .alterTable("api_tokens")
    .addColumn("refresh_used_at", "timestamptz")
    .execute();

  await db.schema
    .createIndex("api_tokens_refresh_hash_idx")
    .ifNotExists()
    .on("api_tokens")
    .column("refresh_token_hash")
    .unique()
    .where(sql.ref("refresh_token_hash"), "is not", null)
    .execute();

  await db.schema
    .createIndex("api_tokens_grant_idx")
    .ifNotExists()
    .on("api_tokens")
    .column("grant_id")
    .where(sql.ref("grant_id"), "is not", null)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex("api_tokens_grant_idx").ifExists().execute();
  await db.schema.dropIndex("api_tokens_refresh_hash_idx").ifExists().execute();
  await db.schema
    .alterTable("api_tokens")
    .dropColumn("refresh_used_at")
    .execute();
  await db.schema
    .alterTable("api_tokens")
    .dropColumn("refresh_expires_at")
    .execute();
  await db.schema
    .alterTable("api_tokens")
    .dropColumn("refresh_token_hash")
    .execute();
  await db.schema.alterTable("api_tokens").dropColumn("grant_id").execute();
  await db.schema
    .dropTable("oauth_authorization_codes")
    .ifExists()
    .execute();
  await db.schema.dropTable("oauth_grants").ifExists().execute();
  await db.schema.dropTable("oauth_clients").ifExists().execute();
}
