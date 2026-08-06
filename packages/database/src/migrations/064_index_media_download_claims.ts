import type { Kysely } from "kysely";
import { sql } from "kysely";
import { executeOnAllTenants } from "./migration-helpers.js";

/**
 * Index outstanding media download claims.
 *
 * The cleanup cycle sweeps rows stuck at `media_download_status = 'downloading'`
 * whose claim lease has expired, so a worker that died mid-download cannot
 * strand the media forever. That sweep runs once per cleanup interval per
 * tenant, and `messages` is the largest table in a tenant schema.
 *
 * The only pre-existing index on that column is partial on `'pending'`, so the
 * sweep planned as a sequential scan over the whole table - measured on a
 * 200k-row table, `Seq Scan` before this index and `Index Scan` after. Left
 * alone, a periodic maintenance task would scale its cost with total message
 * volume on every single run.
 *
 * The index is partial on `'downloading'`, which is a handful of rows at any
 * moment: outstanding claims are transient by definition. It is therefore
 * cheap to build and cheap to maintain, unlike an index over the whole column.
 */
export const MEDIA_DOWNLOAD_CLAIM_INDEX_SUFFIX = "_msg_dl_claim_idx";

export async function up(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    await sql`
      CREATE INDEX IF NOT EXISTS ${sql.ref(
        `${schemaName}${MEDIA_DOWNLOAD_CLAIM_INDEX_SUFFIX}`,
      )}
      ON ${sql.raw(`"${schemaName}"."messages"`)} (media_downloaded_at)
      WHERE media_download_status = 'downloading'
    `.execute(db);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    // Schema-qualified: the migrator's search_path is not the tenant schema.
    await sql`
      DROP INDEX IF EXISTS ${sql.raw(
        `"${schemaName}"."${schemaName}${MEDIA_DOWNLOAD_CLAIM_INDEX_SUFFIX}"`,
      )}
    `.execute(db);
  });
}
