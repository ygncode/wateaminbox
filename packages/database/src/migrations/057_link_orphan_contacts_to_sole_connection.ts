import { type Kysely, sql } from "kysely";
import { executeOnAllTenants } from "./migration-helpers.js";

/**
 * Backfill whatsapp_connection_id for contacts created without one.
 *
 * CSV import historically never set the column, leaving imported contacts
 * unmessageable: every send path resolves the session through the contact's
 * own connection and rejects contacts that have none.
 *
 * Nothing in the schema marks a row as CSV-originated, so the backfill is
 * bounded to the only unambiguous case: tenants with exactly one unarchived
 * connection, where that connection is the only possible owner no matter how
 * the row was created. Constraints applied:
 *
 * - Group rows are excluded (import only creates individual contacts).
 * - Rows whose JID already exists on the connection are left unlinked so the
 *   (whatsapp_connection_id, jid) unique index cannot be violated; those are
 *   duplicates that need a manual merge.
 * - Multi-connection tenants are never guessed at. Their unlinked rows are
 *   healed lazily: a future import that targets a specific connection adopts
 *   matching unlinked rows.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    const contacts = sql.table(`${schemaName}.contacts`);
    const connections = sql.table(`${schemaName}.whatsapp_connections`);
    await sql`
      WITH sole_connection AS (
        SELECT (array_agg(id))[1] AS id
        FROM ${connections}
        WHERE archived_at IS NULL
        HAVING count(*) = 1
      )
      UPDATE ${contacts} AS c
      SET whatsapp_connection_id = sole_connection.id,
          updated_at = now()
      FROM sole_connection
      WHERE c.whatsapp_connection_id IS NULL
        AND c.is_group = false
        AND NOT EXISTS (
          SELECT 1
          FROM ${contacts} AS dup
          WHERE dup.whatsapp_connection_id = sole_connection.id
            AND dup.jid = c.jid
        )
    `.execute(db);
  });
}

export async function down(): Promise<void> {
  // Data backfill: linked rows are indistinguishable from organically linked
  // contacts afterwards, so this migration is intentionally irreversible.
}
