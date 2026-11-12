import type { Kysely } from "kysely";
import { sql } from "kysely";

/**
 * Remember each user's chosen interface language so it follows them across
 * browsers and devices instead of living only in one browser's localStorage.
 *
 * NULL means "never chosen": the client keeps its local or browser-derived
 * default. The value is a BCP-47 tag from the web app's supported list; the
 * API validates it against that list, and the column is bounded so a stray
 * client cannot store arbitrary text. `ADD COLUMN` with no default is a
 * catalog-only change on PostgreSQL 11+ (no table rewrite).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS preferred_language VARCHAR(16)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE users
    DROP COLUMN IF EXISTS preferred_language
  `.execute(db);
}
