import type { Kysely } from "kysely";
import { sql } from "kysely";
import { executeOnAllTenants } from "./migration-helpers.js";

/**
 * Add composite index on messages(contact_id, timestamp DESC, id DESC) for
 * deterministic tuple-keyset conversation pagination and inbox lateral lookup.
 *
 * The existing (contact_id, timestamp DESC) index cannot break ties when
 * multiple messages share a timestamp, which is normal for second-resolution
 * WhatsApp timestamps. This index covers the (timestamp DESC, id DESC) order
 * needed by both the conversation route and the inbox lateral join.
 *
 * The index is also registered in TENANT_INDEX_TARGETS so new tenants receive
 * it automatically via reconcileTenantIndexNames.
 */

const INDEX_SUFFIX = "_msg_ct_ts_id_idx";

export async function up(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    const indexName = `${schemaName}${INDEX_SUFFIX}`;
    await sql`
      CREATE INDEX IF NOT EXISTS ${sql.ref(indexName)}
      ON ${sql.raw(`"${schemaName}"."messages"`)} (contact_id, timestamp DESC, id DESC)
    `.execute(db);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    const indexName = `${schemaName}${INDEX_SUFFIX}`;
    await sql`
      DROP INDEX IF EXISTS ${sql.raw(`"${schemaName}"."${indexName}"`)}
    `.execute(db);
  });
}
