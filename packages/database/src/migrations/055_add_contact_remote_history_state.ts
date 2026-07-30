import { type Kysely, sql } from "kysely";
import { executeOnAllTenants } from "./migration-helpers.js";

/**
 * Remember whether a conversation has more messages available from the
 * primary WhatsApp device. This state is independent from local pagination.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    const contacts = sql.table(`${schemaName}.contacts`);
    await sql`
      ALTER TABLE ${contacts}
      ADD COLUMN IF NOT EXISTS remote_history_status TEXT NOT NULL DEFAULT 'unknown',
      ADD COLUMN IF NOT EXISTS remote_history_updated_at TIMESTAMPTZ
    `.execute(db);
    await sql`
      ALTER TABLE ${contacts}
      DROP CONSTRAINT IF EXISTS contacts_remote_history_status_check,
      ADD CONSTRAINT contacts_remote_history_status_check
      CHECK (remote_history_status IN (
        'unknown',
        'available',
        'requesting',
        'exhausted',
        'unavailable',
        'failed'
      ))
    `.execute(db);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    const contacts = sql.table(`${schemaName}.contacts`);
    await sql`
      ALTER TABLE ${contacts}
      DROP CONSTRAINT IF EXISTS contacts_remote_history_status_check,
      DROP COLUMN IF EXISTS remote_history_updated_at,
      DROP COLUMN IF EXISTS remote_history_status
    `.execute(db);
  });
}
