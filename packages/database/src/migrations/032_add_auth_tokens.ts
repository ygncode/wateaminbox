import { sql, type Kysely } from "kysely";

/**
 * Stores hashed, expiring, single-use email verification and password reset tokens.
 * Raw tokens are only sent to the user and are never persisted.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("auth_tokens")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("user_id", "uuid", (col) =>
      col.references("users.id").onDelete("cascade").notNull(),
    )
    .addColumn("type", "varchar(32)", (col) => col.notNull())
    .addColumn("token_hash", "varchar(64)", (col) => col.unique().notNull())
    .addColumn("expires_at", "timestamptz", (col) => col.notNull())
    .addColumn("used_at", "timestamptz")
    .addColumn("created_at", "timestamptz", (col) =>
      col.defaultTo(sql`now()`).notNull(),
    )
    .addCheckConstraint(
      "auth_tokens_type_check",
      sql`type IN ('email_verification', 'password_reset')`,
    )
    .execute();

  await db.schema
    .createIndex("auth_tokens_user_type_idx")
    .on("auth_tokens")
    .columns(["user_id", "type"])
    .execute();

  await db.schema
    .createIndex("auth_tokens_expires_at_idx")
    .on("auth_tokens")
    .column("expires_at")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("auth_tokens").ifExists().execute();
}
