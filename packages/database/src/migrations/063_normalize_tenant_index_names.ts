import type { Kysely } from "kysely";
import {
  type DuplicateBlocker,
  formatDuplicateBlockers,
  reconcileTenantIndexNames,
  renameTenantRelation,
  TENANT_INDEX_TARGETS,
} from "../tenant-index-names.js";
import { getTenantSchemas } from "./migration-helpers.js";

/**
 * Give every per-tenant index a deterministic, length-safe identifier, and
 * create the ones that were silently never built.
 *
 * PostgreSQL truncates identifiers at 63 bytes without error. A tenant schema
 * name is exactly 43 characters, so 20 historical index names overflowed. Two
 * consequences, one cosmetic and one not:
 *
 *  - The catalog held a truncated name, so the source and the database
 *    disagreed about what existed.
 *  - Three families of names shared their first 20 characters and therefore
 *    truncated to the SAME identifier. `CREATE INDEX IF NOT EXISTS` turned
 *    every one after the first into a silent no-op. The survivor of each
 *    family is whichever was created FIRST, so these were the ones lost:
 *      * scheduled_messages (contact_id, scheduled_at)               - pacing
 *        (migration 056 creates the `next_attempt_at` index just above it,
 *        which is why that one survived and this one did not)
 *      * scheduled_messages (bulk_job_id, status)                    - pacing
 *      * whatsapp_connections (phone_number) UNIQUE                  - INTEGRITY
 *      * whatsapp_labels (whatsapp_connection_id, synced_tag_id) UNIQUE - INTEGRITY
 *
 * The two UNIQUE ones matter beyond performance: the application assumes those
 * guarantees hold, so their absence permits duplicate WhatsApp connections for
 * one phone number and duplicate label/tag links.
 *
 * Renames are catalog-only - PostgreSQL does not rebuild or move data for
 * `ALTER INDEX ... RENAME TO`, so this is cheap even on large tables. Only the
 * four genuinely missing indexes are built.
 *
 * FAIL-CLOSED ON DUPLICATES: a UNIQUE index cannot be created over rows that
 * already conflict. This migration never deletes or merges customer rows to
 * force one through. It collects every conflict across every tenant, then
 * aborts with a report. The migration runs in a transaction, so an abort
 * leaves the database exactly as it was; fix the duplicates and re-run.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const schemas = await getTenantSchemas(db);
  const blocked: DuplicateBlocker[] = [];
  let renamed = 0;
  let created = 0;
  let dropped = 0;

  for (const schemaName of schemas) {
    const result = await reconcileTenantIndexNames(db, schemaName);
    renamed += result.renamed.length;
    created += result.created.length;
    dropped += result.droppedRedundant.length;
    blocked.push(...result.blocked);

    if (result.created.length > 0) {
      console.log(
        `[063] ${schemaName}: created ${result.created.join(", ")}`,
      );
    }
    if (result.skipped.length > 0) {
      console.log(
        `[063] ${schemaName}: skipped (table/column absent) ${result.skipped.join(", ")}`,
      );
    }
  }

  console.log(
    `[063] ${schemas.length} tenant schema(s): ${renamed} renamed, ${created} created, ${dropped} redundant duplicate(s) removed`,
  );

  if (blocked.length > 0) {
    // Aborting rolls the whole migration back - deliberately. Applying the
    // safe half while a UNIQUE guarantee stays missing would hide the problem.
    throw new Error(formatDuplicateBlockers(blocked));
  }
}

/**
 * Restore the historical (truncated) identifiers.
 *
 * Indexes this migration created because they had been silently missing are
 * intentionally NOT dropped: they were meant to exist all along, and dropping
 * a UNIQUE index would give back a data-integrity hole. Only the renames are
 * reversed, so a rollback returns to the previous naming without reopening it.
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  const { sql } = await import("kysely");
  const schemas = await getTenantSchemas(db);

  for (const schemaName of schemas) {
    for (const target of TENANT_INDEX_TARGETS) {
      const current = `${schemaName}${target.suffix}`;
      const legacy = `${schemaName}${target.legacySuffix}`.slice(0, 63);
      if (current === legacy) continue;

      const exists = await sql<{ exists: boolean }>`
        SELECT EXISTS (
          SELECT 1 FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = ${schemaName} AND c.relname = ${current}
        ) AS exists
      `.execute(db);
      if (!exists.rows[0]?.exists) continue;

      // A legacy name may already be taken by a truncation sibling; leave the
      // canonical name in place rather than colliding.
      const taken = await sql<{ exists: boolean }>`
        SELECT EXISTS (
          SELECT 1 FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = ${schemaName} AND c.relname = ${legacy}
        ) AS exists
      `.execute(db);
      if (taken.rows[0]?.exists) continue;

      // Same helper `up` renames with, so the two cannot disagree about
      // whether a relation is a constraint or a bare index.
      await renameTenantRelation(db, schemaName, target, current, legacy);
    }
  }
}
