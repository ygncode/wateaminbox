import { type Kysely, sql } from "kysely";
import {
  ensureChannelSpineTenantSchema,
  SYSTEM_SUPPRESSION_ACTOR,
} from "../channel-spine-schema.js";
import { executeOnAllTenants } from "./migration-helpers.js";

/**
 * Customer suppression core (contact blocking across channels).
 *
 * `contact_suppressions` has existed since the channel spine landed but
 * nothing wrote it. This makes it usable:
 *
 * - `expires_at` (automatic flood mutes end on their own) and `revoked_by`;
 * - a CHECK on the three scopes - `block`, `mute_inbound`, `do_not_contact` -
 *   added NOT VALID so it costs no scan; the table is empty everywhere;
 * - one active row per (contact, scope), so concurrent blocks cannot pile up
 *   duplicates and revoking one cannot leave another silently in force.
 *
 * Then every WhatsApp contact that is blocked today gets the matching `block`
 * suppression. See `backfillLegacyBlockSuppressions`.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    await ensureChannelSpineTenantSchema(db, schemaName);
    await backfillLegacyBlockSuppressions(db, schemaName);
  });
}

/**
 * Give each blocked contact a `block` suppression on that same row.
 *
 * Suppressions are read across a customer's whole merge group, so a blocked
 * contact that was merged away keeps the surviving customer blocked without
 * anything having to move. Groups are never suppressed: a block names a
 * person. Idempotent - an already-active block is left alone.
 */
export async function backfillLegacyBlockSuppressions<Database>(
  db: Kysely<Database>,
  schemaName: string,
): Promise<number> {
  const table = (name: string) => sql.table(`${schemaName}.${name}`);
  const result = await sql`
    INSERT INTO ${table("contact_suppressions")}
      (contact_id, scope, reason, created_by)
    SELECT id, 'block', 'legacy:is_blocked', ${SYSTEM_SUPPRESSION_ACTOR}::uuid
    FROM ${table("contacts")}
    WHERE is_blocked = true AND is_group = false
    ON CONFLICT (contact_id, scope) WHERE revoked_at IS NULL DO NOTHING
  `.execute(db);
  return Number(result.numAffectedRows ?? 0);
}

/**
 * Forward-only, like the spine schema it extends: dropping suppressions would
 * silently unblock customers.
 */
export async function down(): Promise<void> {
  throw new Error("migration 115 is forward-only");
}
