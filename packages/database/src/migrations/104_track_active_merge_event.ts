import { type Kysely, sql } from "kysely";
import { ensureChannelSpineTenantSchema } from "../channel-spine-schema.js";
import { executeOnAllTenants } from "./migration-helpers.js";

/**
 * Track the merge event currently in effect for a merged-away contact.
 *
 * `contacts.merged_into_contact_id` only names the survivor, not the specific
 * `contact_merge_events` row that is active. Two merge events can share the
 * same `(source, target)` pair (merge A -> unmerge A -> merge B), so the
 * service-level supersede guard in `unmergeContacts` cannot tell A and B apart
 * from the survivor id alone and would allow reversing the stale event A
 * after B is in effect. `active_merge_event_id` is the single source of truth
 * for "which merge event is in effect", set by `mergeContacts` and cleared by
 * `unmergeContacts`.
 *
 * The reconcile/`ensureChannelSpineTenantSchema` path adds the column, the FK
 * to `contact_merge_events(id)`, and a partial unique index (at most one
 * active merge event per contact) for newly-created tenants. This migration
 * applies the same additive schema to every existing tenant and backfills
 * the column for contacts merged before it existed, so the service guard can
 * identify the in-effect merge event for pre-existing merges too.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    await ensureChannelSpineTenantSchema(db, schemaName);

    const table = (name: string) => sql.raw(`"${schemaName}"."${name}"`);

    // Backfill `active_merge_event_id` for contacts that were merged before
    // this column existed. The in-effect event for a merged source is the one
    // whose target matches `merged_into_contact_id`; ties on `created_at` are
    // broken by `id` so the choice is deterministic. Rows with no surviving
    // matching event (none expected, since setting `merged_into_contact_id`
    // always inserted a `contact_merge_events` row) are left null.
    await sql`
      UPDATE ${table("contacts")} AS source
      SET active_merge_event_id = (
        SELECT merge_event.id
        FROM ${table("contact_merge_events")} AS merge_event
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

/**
 * Production migrations are forward-only. The down path is intentionally
 * blocked because dropping the in-effect merge event pointer would strand
 * existing merged contacts and break the unmerge correction path.
 */
export async function down(): Promise<void> {
  throw new Error("migration 104 is forward-only");
}
