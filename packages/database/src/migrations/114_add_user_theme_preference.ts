import type { Kysely } from "kysely";
import { sql } from "kysely";

/**
 * Remember each user's interface theme so it follows their account across
 * browsers and devices (web and mobile) instead of living in one browser's
 * localStorage.
 *
 * NULL means "never chosen": clients use their default (`system`). The value
 * is one of the shared THEME_PREFERENCES ids; the API validates it and the
 * column is bounded. `ADD COLUMN` with no default is a catalog-only change on
 * PostgreSQL 11+ (no table rewrite).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS theme_preference VARCHAR(32)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE users
    DROP COLUMN IF EXISTS theme_preference
  `.execute(db);
}
