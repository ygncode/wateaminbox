import { type Kysely, sql } from "kysely";
import { forEachTenant } from "./migration-helpers.js";

/**
 * Give a contact endpoint its own avatar.
 *
 * A channel conversation need not have a contact row, so `contacts.avatar_url`
 * cannot hold the picture for a Telegram person. The endpoint is the identity
 * the provider actually names, so the avatar belongs with it.
 *
 * `avatar_fetched_at` records the last attempt, successful or not, so a
 * refresh loop can back off instead of asking the provider on every message
 * for someone who simply has no photo.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await forEachTenant(db, async (schema) => {
    await sql`SET lock_timeout = '5s'`.execute(db);
    await sql`ALTER TABLE ${sql.table(`${schema}.contact_endpoints`)}
      ADD COLUMN IF NOT EXISTS avatar_url TEXT,
      ADD COLUMN IF NOT EXISTS avatar_fetched_at TIMESTAMPTZ`.execute(db);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await forEachTenant(db, async (schema) => {
    await sql`ALTER TABLE ${sql.table(`${schema}.contact_endpoints`)}
      DROP COLUMN IF EXISTS avatar_url,
      DROP COLUMN IF EXISTS avatar_fetched_at`.execute(db);
  });
}
