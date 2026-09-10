import { type Kysely, sql } from "kysely";
import { executeOnAllTenants } from "./migration-helpers.js";

/**
 * Migration 090: Enforce per-tenant uniqueness of `quick_replies.shortcut`.
 *
 * PROBLEM:
 * `quick_replies.shortcut` carried only a plain (non-unique) index. The
 * service enforced uniqueness with a non-atomic SELECT-then-INSERT, so two
 * concurrent POST /quick-replies for the same shortcut both passed the check
 * and both inserted, persisting duplicate `shortcut` rows that each returned
 * `201` to the client.
 *
 * SOLUTION:
 * For every tenant schema: collapse any pre-existing duplicate shortcuts to a
 * single surviving row (re-pointing `auto_reply_settings.quick_reply_id` and
 * `scheduled_messages.auto_reply_quick_reply_id` at the survivor first, so no
 * template binding is lost and `ON DELETE SET NULL` cannot silently disable an
 * enabled rule), retire the legacy non-unique index, and create a UNIQUE index
 * on `(shortcut)`. The service then relies on the database's
 * `unique_violation` (SQLSTATE 23505) instead of the racy pre-check.
 *
 * The survivor for each shortcut is chosen to preserve operator intent: the
 * row the workspace's single `auto_reply_settings` row points at, else the row
 * a queued auto-reply still references, else the most recently created row.
 */

/**
 * Bring one tenant schema's `quick_replies` table under the uniqueness
 * invariant. Exported so a migration test can drive exactly one schema
 * instead of `up`'s "every tenant_%" fan-out (which would mutate unrelated
 * test schemas).
 */
export async function applyQuickRepliesShortcutUnique(
  db: Kysely<unknown>,
  schemaName: string,
): Promise<void> {
  const quickReplies = sql.table(`${schemaName}.quick_replies`);
  const autoReplySettings = sql.table(`${schemaName}.auto_reply_settings`);
  const scheduledMessages = sql.table(`${schemaName}.scheduled_messages`);

  // The same survivor rule is applied in each statement so the row references
  // are re-pointed at is exactly the row kept. Computed inline per statement
  // because the shared `db` is a pool and a TEMP table would not survive across
  // separate `execute` calls; the CTE is cheap on the small `quick_replies` table.
  const survivorSql = sql`
    SELECT DISTINCT ON (shortcut) id AS survivor_id, shortcut
    FROM ${quickReplies} AS qr
    ORDER BY
      shortcut,
      (EXISTS (
        SELECT 1 FROM ${autoReplySettings} AS ars
        WHERE ars.id = 1 AND ars.quick_reply_id = qr.id
      )) DESC,
      (EXISTS (
        SELECT 1 FROM ${scheduledMessages} AS sm
        WHERE sm.auto_reply_quick_reply_id = qr.id
      )) DESC,
      qr.created_at DESC,
      qr.id DESC
  `;

  await db.transaction().execute(async (trx) => {
    // Re-point the single auto_reply_settings row at the survivor for its
    // shortcut before any duplicate is deleted. The survivor rule already
    // prefers the row auto_reply_settings points at, so this is a no-op in
    // the common case - but it is the guarantee that ON DELETE SET NULL can
    // never null `quick_reply_id` and quietly break the rule's
    // `NOT enabled OR quick_reply_id IS NOT NULL` invariant.
    await sql`
      WITH survivor AS (${survivorSql})
      UPDATE ${autoReplySettings} AS ars
      SET quick_reply_id = survivor.survivor_id, updated_at = now()
      FROM survivor
      WHERE ars.quick_reply_id <> survivor.survivor_id
        AND ars.quick_reply_id IN (
          SELECT qr.id FROM ${quickReplies} AS qr
          WHERE qr.shortcut = survivor.shortcut
        )
    `.execute(trx);

    // Re-point queued auto-replies that still reference a doomed duplicate.
    // `auto_reply_quick_reply_id` is a plain UUID column (no FK), so deleting
    // the duplicate would otherwise dangle the reference and the queued reply
    // would later send a stranger's template.
    await sql`
      WITH survivor AS (${survivorSql})
      UPDATE ${scheduledMessages} AS sm
      SET auto_reply_quick_reply_id = survivor.survivor_id, updated_at = now()
      FROM survivor
      WHERE sm.auto_reply_quick_reply_id <> survivor.survivor_id
        AND sm.auto_reply_quick_reply_id IN (
          SELECT qr.id FROM ${quickReplies} AS qr
          WHERE qr.shortcut = survivor.shortcut
        )
    `.execute(trx);

    // Nothing references a non-survivor now; delete the duplicates so the
    // UNIQUE index below can be built without a pre-existing conflict.
    await sql`
      WITH survivor AS (${survivorSql})
      DELETE FROM ${quickReplies}
      WHERE id NOT IN (SELECT survivor_id FROM survivor)
    `.execute(trx);

    // Replace the legacy non-unique index with the UNIQUE one. The legacy
    // name overflows PostgreSQL's 63-byte identifier limit and is silently
    // truncated by the server, so drop the truncated form the catalog holds.
    const legacyIndex = `${schemaName}_quick_replies_shortcut_idx`.slice(0, 63);
    await sql`DROP INDEX IF EXISTS ${sql.id(schemaName, legacyIndex)}`.execute(
      trx,
    );
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS ${sql.ref(
        `${schemaName}_qr_shortcut_uidx`,
      )}
      ON ${quickReplies} (shortcut)
    `.execute(trx);
  });
}

/** Reverse the unique index for a single schema (migration `down`). */
export async function removeQuickRepliesShortcutUnique(
  db: Kysely<unknown>,
  schemaName: string,
): Promise<void> {
  const quickReplies = sql.table(`${schemaName}.quick_replies`);
  await sql`DROP INDEX IF EXISTS ${sql.id(
    schemaName,
    `${schemaName}_qr_shortcut_uidx`,
  )}`.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS ${sql.ref(
      `${schemaName}_quick_replies_shortcut_idx`.slice(0, 63),
    )}
    ON ${quickReplies} (shortcut)
  `.execute(db);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    await applyQuickRepliesShortcutUnique(db, schemaName);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    await removeQuickRepliesShortcutUnique(db, schemaName);
  });
}
