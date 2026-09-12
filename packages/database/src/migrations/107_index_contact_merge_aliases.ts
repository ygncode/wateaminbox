import type { Kysely } from "kysely";
import { sql } from "kysely";
import { executeOnAllTenants } from "./migration-helpers.js";

/**
 * Index the merge alias in its reverse direction.
 *
 * `contacts.merged_into_contact_id` has a foreign key but no index, which
 * serves the upward walk (`resolveCanonicalContactId` reads a row by primary
 * key) and nothing else. The chat list and the chat switcher ask the opposite
 * question - which rows were merged into this one - once per listed contact.
 * Without an index that is a sequential scan of the whole contact table per
 * row, on a query whose own comments record a variant that ran for over five
 * minutes before it was cancelled.
 *
 * Partial on `IS NOT NULL`: merges are rare by construction, so the index
 * stays a few pages even on the largest workspace while still answering the
 * lookup, and unmerged rows never enter it.
 *
 * Non-concurrent is acceptable here because the index is built over only the
 * merged rows, of which there are currently none in any workspace. Kysely
 * wraps each migration in a transaction and `CREATE INDEX CONCURRENTLY`
 * cannot run inside one.
 */

/** Index names must stay under PostgreSQL's 63-byte identifier limit. */
export const CONTACT_MERGE_ALIAS_INDEX = (schemaName: string): string =>
  `${schemaName}_merged_into_idx`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    await sql`
      CREATE INDEX IF NOT EXISTS ${sql.ref(CONTACT_MERGE_ALIAS_INDEX(schemaName))}
      ON ${sql.raw(`"${schemaName}"."contacts"`)} (merged_into_contact_id)
      WHERE merged_into_contact_id IS NOT NULL
    `.execute(db);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    // Schema-qualified: the migrator's search_path is not the tenant schema,
    // so an unqualified DROP INDEX IF EXISTS would silently match nothing.
    await sql`
      DROP INDEX IF EXISTS ${sql.raw(
        `"${schemaName}"."${CONTACT_MERGE_ALIAS_INDEX(schemaName)}"`,
      )}
    `.execute(db);
  });
}
