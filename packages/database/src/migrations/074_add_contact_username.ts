import type { Kysely } from "kysely";
import { sql } from "kysely";
import { executeOnAllTenants } from "./migration-helpers.js";

/**
 * Store WhatsApp's public username separately from phone numbers and names.
 *
 * Usernames are authoritative identity metadata supplied by WhatsApp history
 * sync. Keeping them separate prevents opaque LIDs from being reused as names
 * while allowing private-number contacts to remain recognizable.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw("SET LOCAL lock_timeout = '5s'").execute(db);
  await sql.raw("SET LOCAL statement_timeout = '30s'").execute(db);

  await executeOnAllTenants(db, async (schemaName) => {
    const contacts = sql.table(`${schemaName}.contacts`);
    await sql`
      ALTER TABLE ${contacts}
      ADD COLUMN IF NOT EXISTS username TEXT
    `.execute(db);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    const contacts = sql.table(`${schemaName}.contacts`);
    await sql`
      ALTER TABLE ${contacts}
      DROP COLUMN IF EXISTS username
    `.execute(db);
  });
}
