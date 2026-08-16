import type { Kysely } from "kysely";
import { sql } from "kysely";
import { executeOnAllTenants } from "./migration-helpers.js";

/**
 * Apply the media deletion-intent marker to ONE tenant schema.
 *
 * Exported for the same reason as 066's per-schema step: `up` fans this out
 * over every `tenant_%` schema, which cannot run hermetically in a shared test
 * database, so CI exercises this function directly.
 */
export async function applyMediaDeletionIntent(
  db: Kysely<unknown>,
  schemaName: string,
): Promise<void> {
  const cleanupItems = sql.table(`${schemaName}.purge_cleanup_items`);
  // The canonical object key a media item is reclaiming. Writers look an
  // incoming reference up by key, because one object has many valid reference
  // spellings; the queue's own `reference` column cannot serve that lookup.
  await sql`
    ALTER TABLE ${cleanupItems}
    ADD COLUMN IF NOT EXISTS media_key TEXT
  `.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS ${sql.ref(`${schemaName}_pci_media_key_idx`)}
    ON ${cleanupItems} (media_key)
    WHERE media_key IS NOT NULL
  `.execute(db);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, (schemaName) =>
    applyMediaDeletionIntent(db, schemaName),
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    await sql`
      ALTER TABLE ${sql.table(`${schemaName}.purge_cleanup_items`)}
      DROP COLUMN IF EXISTS media_key
    `.execute(db);
  });
}
