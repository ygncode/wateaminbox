import { type Kysely, sql } from "kysely";
import { ensureContactActiveMergeEventSchema } from "../contact-active-merge-event-schema.js";
import { executeOnAllTenants } from "./migration-helpers.js";

/**
 * Record which merge is in effect for a merged-away contact (#378), and
 * backfill it for contacts merged before the column existed.
 *
 * A merge only happens to an unmerged contact and an unmerge clears the
 * alias, so for a contact that is still merged the newest event moving it
 * into its current survivor is the one in effect.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    await ensureContactActiveMergeEventSchema(db, schemaName);
    const contacts = sql.table(`${schemaName}.contacts`);
    const events = sql.table(`${schemaName}.contact_merge_events`);
    await sql`
      UPDATE ${contacts} AS source
      SET active_merge_event_id = (
        SELECT merge_event.id
        FROM ${events} AS merge_event
        WHERE merge_event.source_contact_id = source.id
          AND merge_event.target_contact_id = source.merged_into_contact_id
        ORDER BY merge_event.created_at DESC, merge_event.id DESC
        LIMIT 1
      )
      WHERE source.merged_into_contact_id IS NOT NULL
        AND source.active_merge_event_id IS NULL
    `.execute(db);
  });
}

export async function down(): Promise<void> {
  throw new Error("migration 118 is forward-only");
}
