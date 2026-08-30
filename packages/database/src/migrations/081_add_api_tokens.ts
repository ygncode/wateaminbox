import { sql, type Kysely } from "kysely";

/**
 * Stores hashed, revocable per-user API tokens used by the MCP endpoint.
 * Raw tokens (wti_ prefix) are shown once at creation and never persisted.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("api_tokens")
    .ifNotExists()
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("user_id", "uuid", (col) =>
      col.references("users.id").onDelete("cascade").notNull(),
    )
    .addColumn("company_id", "uuid", (col) =>
      col.references("companies.id").onDelete("cascade").notNull(),
    )
    .addColumn("name", "varchar(100)", (col) => col.notNull())
    .addColumn("token_hash", "varchar(64)", (col) => col.unique().notNull())
    .addColumn("token_prefix", "varchar(12)", (col) => col.notNull())
    .addColumn("scopes", sql`text[]`, (col) => col.notNull())
    .addColumn("last_used_at", "timestamptz")
    .addColumn("expires_at", "timestamptz")
    .addColumn("revoked_at", "timestamptz")
    .addColumn("created_at", "timestamptz", (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .addCheckConstraint(
      "api_tokens_scopes_check",
      sql`scopes <@ ARRAY['read', 'write']::text[] AND array_length(scopes, 1) >= 1`,
    )
    .execute();

  await db.schema
    .createIndex("api_tokens_company_idx")
    .ifNotExists()
    .on("api_tokens")
    .column("company_id")
    .execute();

  await db.schema
    .createIndex("api_tokens_user_company_idx")
    .ifNotExists()
    .on("api_tokens")
    .columns(["user_id", "company_id"])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("api_tokens").ifExists().execute();
}
