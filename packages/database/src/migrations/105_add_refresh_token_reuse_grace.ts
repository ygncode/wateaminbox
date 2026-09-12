import { type Kysely, sql } from "kysely";

/**
 * Accept a just-superseded refresh token for a short window.
 *
 * `user_sessions.refresh_token` is single-use: every refresh replaces the
 * stored hash, so a browser that holds a token the database has already
 * rotated past cannot refresh again and is sent back to the login screen.
 * That is the intended protection against a replayed token, but it also
 * fires on two benign races:
 *
 * 1. A response lost in transit. The request reached the API, the rotation
 *    committed, and the reply never arrived - a container replaced
 *    mid-request during a deployment, a dropped connection, a proxy reset.
 *    The browser keeps the old token while the database holds the new one.
 * 2. Two tabs refreshing at the same moment. The client coalesces concurrent
 *    refreshes within one document, but not across tabs, so the second tab
 *    presents the token the first tab just retired.
 *
 * The column holds the recently retired hashes as
 * `[{"hash": "<sha256 hex>", "expiresAt": "<ISO 8601>"}]`, newest last. A
 * refresh that presents a retired hash whose entry has not expired is treated
 * as a retry rather than a replay, and every rotation moves the hash it
 * replaced into this list. Entries are never extended: each one expires
 * `JWT_REFRESH_REUSE_GRACE_SECONDS` after the rotation that superseded it,
 * which is what keeps the window bounded. Outside the window, and with the
 * grace set to `0`, replay is rejected exactly as before.
 *
 * Unindexed on purpose. Every read already arrives with the session's primary
 * key, so this is a column on a point read, not a search. A JSONB column is
 * enough for a list bounded by the grace window and the entry cap.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET lock_timeout = '5s'`.execute(db);
  await sql`ALTER TABLE public.user_sessions
    ADD COLUMN IF NOT EXISTS previous_refresh_tokens JSONB NOT NULL DEFAULT '[]'::jsonb`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET lock_timeout = '5s'`.execute(db);
  await sql`ALTER TABLE public.user_sessions
    DROP COLUMN IF EXISTS previous_refresh_tokens`.execute(db);
}
