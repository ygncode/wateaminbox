import type { Kysely } from "kysely";
import { sql } from "kysely";
import { executeOnAllTenants } from "./migration-helpers.js";

/**
 * Index the two reverse-direction lookups that had no index to use.
 *
 * 1. `whatsmeow_lid_mappings(connection_id, jid)`.
 *
 *    The primary key is `(connection_id, lid)`, which serves `GetPNForLID`.
 *    `GetLIDForPN` and `GetManyLIDsForPNs` (services/whatsapp/internal/store/
 *    extras.go) ask the same question in the other direction - given a phone
 *    number, which LID - and nothing indexed `jid`. The expression indexes
 *    from migration 075 cannot stand in: they index `split_part(...)` of the
 *    column, and the planner cannot match those against a plain `jid = $2`.
 *
 *    The lookup could therefore use only `connection_id` from the primary key
 *    and filter the rest of that connection's mappings away row by row.
 *    Putting `jid` in the key turns it into a point read.
 *
 * 2. `group_participants(group_id)`.
 *
 *    Migration 062 indexed `participant_jid` on this table for realtime
 *    fan-out and stopped there, but the group panel's own membership read
 *    (group.service.ts) filters on `group_id`. That had only the primary key
 *    on `id`, so every group-detail request scanned the whole table.
 *
 * Both tables are bounded by connection and group membership rather than by
 * traffic, which is what makes a non-concurrent build acceptable here. Kysely
 * wraps each migration in a transaction and `CREATE INDEX CONCURRENTLY` cannot
 * run inside one, so a table that grows with message volume has to go through
 * the concurrent index runner instead; the matching `messages` index does
 * exactly that. See `channel-spine-index-runner.ts`.
 */

/** Index names must stay under PostgreSQL's 63-byte identifier limit. */
export const GROUP_PARTICIPANT_GROUP_INDEX = (schemaName: string): string =>
  `${schemaName}_gp_group_idx`;

export async function up(db: Kysely<unknown>): Promise<void> {
  // Not a tenant table: WhatsApp identity mappings are keyed by connection and
  // live once in `whatsapp_sessions`, alongside the rest of the whatsmeow
  // store. Migration 075 indexed this same table from the same schema.
  await sql`
    CREATE INDEX IF NOT EXISTS whatsmeow_lid_mappings_connection_jid_idx
    ON whatsapp_sessions.whatsmeow_lid_mappings (connection_id, jid)
  `.execute(db);

  await executeOnAllTenants(db, async (schemaName) => {
    const table = (name: string) => sql.raw(`"${schemaName}"."${name}"`);

    await sql`
      CREATE INDEX IF NOT EXISTS ${sql.ref(
        GROUP_PARTICIPANT_GROUP_INDEX(schemaName),
      )}
      ON ${table("group_participants")} (group_id)
    `.execute(db);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    // Schema-qualified: the migrator's search_path is not the tenant schema,
    // so an unqualified DROP INDEX IF EXISTS would silently match nothing.
    await sql`
      DROP INDEX IF EXISTS ${sql.raw(
        `"${schemaName}"."${GROUP_PARTICIPANT_GROUP_INDEX(schemaName)}"`,
      )}
    `.execute(db);
  });

  await sql`
    DROP INDEX IF EXISTS
      whatsapp_sessions.whatsmeow_lid_mappings_connection_jid_idx
  `.execute(db);
}
