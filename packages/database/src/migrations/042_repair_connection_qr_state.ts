import { type Kysely, sql } from "kysely";
import { executeOnAllTenants } from "./migration-helpers.js";

/**
 * Repair tenants created after migration 033 ran. The tenant setup function did
 * not include persisted QR state, so those schemas were missing both columns.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    await sql`
      ALTER TABLE ${sql.raw(`"${schemaName}".whatsapp_connections`)}
      ADD COLUMN IF NOT EXISTS qr_code TEXT,
      ADD COLUMN IF NOT EXISTS qr_expires_at TIMESTAMPTZ
    `.execute(db);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    await sql`
      ALTER TABLE ${sql.raw(`"${schemaName}".whatsapp_connections`)}
      DROP COLUMN IF EXISTS qr_code,
      DROP COLUMN IF EXISTS qr_expires_at
    `.execute(db);
  });
}
