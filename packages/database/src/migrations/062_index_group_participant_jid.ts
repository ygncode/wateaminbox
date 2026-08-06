import type { Kysely } from "kysely";
import { sql } from "kysely";
import { executeOnAllTenants } from "./migration-helpers.js";

/**
 * Index `group_participants(participant_jid)`.
 *
 * Realtime fan-out for contact-identity events (`contact:profile_picture`)
 * has to answer "which conversations does this WhatsApp JID appear in", so the
 * update reaches exactly the users authorized to read them. A group
 * participant usually has no standalone contact row, so the direct
 * `contacts.jid` lookup misses them and the answer has to come from group
 * membership.
 *
 * Membership - not message history - is the correct source for that question,
 * and it is also the affordable one: `group_participants` is bounded by how
 * many people are in a tenant's groups, whereas `messages` grows without bound
 * with traffic. Indexing this column keeps the lookup a point read on an
 * already-small table. The join back to `groups` uses that table's primary
 * key, so no second index is needed for the query this serves.
 *
 * Created NON-concurrently on purpose: Kysely's migrator wraps each migration
 * in a transaction and `CREATE INDEX CONCURRENTLY` cannot run inside one.
 * Keeping this to a small table is what makes the brief write lock acceptable;
 * the same index on `messages` would not have been.
 *
 * The name uses the repository's short `gp_` prefix rather than the full table
 * name: a tenant schema name is already 43 characters, and PostgreSQL
 * truncates identifiers at 63 bytes, which would silently collapse longer
 * per-table index names into one another.
 */

/** Index names must stay under PostgreSQL's 63-byte identifier limit. */
export const GROUP_PARTICIPANT_JID_INDEX = (schemaName: string): string =>
  `${schemaName}_gp_jid_idx`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    const table = (name: string) => sql.raw(`"${schemaName}"."${name}"`);

    await sql`
      CREATE INDEX IF NOT EXISTS ${sql.ref(
        GROUP_PARTICIPANT_JID_INDEX(schemaName),
      )}
      ON ${table("group_participants")} (participant_jid)
    `.execute(db);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    // Schema-qualified: the migrator's search_path is not the tenant schema,
    // so an unqualified DROP INDEX IF EXISTS would silently match nothing.
    await sql`
      DROP INDEX IF EXISTS ${sql.raw(
        `"${schemaName}"."${GROUP_PARTICIPANT_JID_INDEX(schemaName)}"`,
      )}
    `.execute(db);
  });
}
