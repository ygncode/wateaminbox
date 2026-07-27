import type { Kysely } from "kysely";
import { sql } from "kysely";
import { executeOnAllTenants } from "./migration-helpers.js";

/**
 * Reconcile the two historical conversation_states schemas.
 *
 * Early tenants received resolution fields while later setup function versions
 * received unread-state fields. The application uses both sets of fields.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    const table = sql.raw(`"${schemaName}".conversation_states`);

    await sql`
      ALTER TABLE ${table}
      ADD COLUMN IF NOT EXISTS read_by_user_id UUID,
      ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS last_message_preview TEXT,
      ADD COLUMN IF NOT EXISTS unread_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS status conversation_status NOT NULL DEFAULT 'open',
      ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS resolved_by UUID,
      ADD COLUMN IF NOT EXISTS reopened_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS reopened_by UUID,
      ADD COLUMN IF NOT EXISTS resolution_notes TEXT
    `.execute(db);

    await sql`
      CREATE INDEX IF NOT EXISTS ${sql.ref(`${schemaName}_conv_states_status_idx`)}
      ON ${table} (status)
    `.execute(db);
    await sql`
      CREATE INDEX IF NOT EXISTS ${sql.ref(`${schemaName}_conv_states_resolved_idx`)}
      ON ${table} (resolved_at)
    `.execute(db);
  });
}

export async function down(_db: Kysely<unknown>): Promise<void> {
  // Additive reconciliation is intentionally not reverted: some tenant schemas
  // had either set of columns before this migration.
}
