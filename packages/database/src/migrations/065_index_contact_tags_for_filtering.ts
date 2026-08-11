import type { Kysely } from "kysely";
import { sql } from "kysely";
import { executeOnAllTenants } from "./migration-helpers.js";

/**
 * Support inbox and audience filtering by workspace tag.
 *
 * `contact_tags` is keyed by `(contact_id, tag_id)`, which is ideal when
 * loading one contact but cannot efficiently find every contact carrying one
 * of a set of tags. Reversing the columns gives tag filters a selective index
 * while retaining `contact_id` for the join back to contacts.
 */
export const CONTACT_TAG_FILTER_INDEX = (schemaName: string): string =>
  `${schemaName}_ct_tag_contact_idx`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    await sql`
      CREATE INDEX IF NOT EXISTS ${sql.ref(CONTACT_TAG_FILTER_INDEX(schemaName))}
      ON ${sql.raw(`"${schemaName}"."contact_tags"`)} (tag_id, contact_id)
    `.execute(db);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    await sql`
      DROP INDEX IF EXISTS ${sql.raw(
        `"${schemaName}"."${CONTACT_TAG_FILTER_INDEX(schemaName)}"`,
      )}
    `.execute(db);
  });
}
