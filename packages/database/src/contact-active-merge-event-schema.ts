import { type Kysely, sql } from "kysely";

/** Index names must stay under PostgreSQL's 63-byte identifier limit. */
export const CONTACT_ACTIVE_MERGE_EVENT_INDEX = (schemaName: string): string =>
  `${schemaName}_active_merge_idx`;

/**
 * Migration 118 and new-tenant reconciliation share this additive upgrade.
 *
 * `merged_into_contact_id` names the survivor, not the merge that put the
 * contact there, and two merge events can share a survivor (merge A, unmerge
 * A, merge B). `active_merge_event_id` names the one in effect, so only that
 * merge can be reversed.
 *
 * ON DELETE SET NULL rather than RESTRICT: the connection and channel-account
 * purges delete merge events while a contact on another connection may still
 * point at one, and a RESTRICT key would make those purges fail. A cleared
 * pointer fails closed - the merge can no longer be reversed.
 *
 * The partial index serves that foreign key; without it every merge-event
 * delete scans the contact table. It is built non-concurrently, as migration
 * 107's is, because only merged rows enter it.
 */
export async function ensureContactActiveMergeEventSchema<DB>(
  db: Kysely<DB>,
  schemaName: string,
): Promise<void> {
  const contacts = sql.table(`${schemaName}.contacts`);
  const events = sql.table(`${schemaName}.contact_merge_events`);
  await sql`ALTER TABLE ${contacts}
    ADD COLUMN IF NOT EXISTS active_merge_event_id UUID`.execute(db);
  const constraint = await sql<{ exists: boolean }>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_constraint AS constraint_record
      JOIN pg_class AS table_record ON table_record.oid = constraint_record.conrelid
      JOIN pg_namespace AS schema_record ON schema_record.oid = table_record.relnamespace
      WHERE schema_record.nspname = ${schemaName}
        AND table_record.relname = 'contacts'
        AND constraint_record.conname = 'contacts_active_merge_event_fk'
    ) AS exists
  `.execute(db);
  if (!constraint.rows[0]?.exists) {
    await sql`ALTER TABLE ${contacts}
      ADD CONSTRAINT contacts_active_merge_event_fk
      FOREIGN KEY (active_merge_event_id) REFERENCES ${events}(id)
      ON DELETE SET NULL`.execute(db);
  }
  await sql`
    CREATE INDEX IF NOT EXISTS ${sql.ref(CONTACT_ACTIVE_MERGE_EVENT_INDEX(schemaName))}
    ON ${contacts} (active_merge_event_id)
    WHERE active_merge_event_id IS NOT NULL
  `.execute(db);
}
