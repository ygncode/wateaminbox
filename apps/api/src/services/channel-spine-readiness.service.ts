import type { TenantDatabase } from "@wateaminbox/database";
import type { Kysely } from "kysely";
import { sql } from "kysely";

const requiredSuffixes = [
  "msg_external_uidx",
  "msg_idempotency_uidx",
  "mr_external_uidx",
  "ma_fetch_due_idx",
] as const;

/** Provider enablement fails closed until every online index build completed. */
export async function isChannelSpineTenantReady(
  tenantDb: Kysely<TenantDatabase>,
): Promise<boolean> {
  try {
    const result = await sql<{ suffix: string; valid: boolean }>`
      SELECT suffixes.suffix,
        COALESCE(index_record.indisvalid, false) AS valid
      FROM unnest(${requiredSuffixes}::text[]) AS suffixes(suffix)
      LEFT JOIN pg_class AS relation
        ON relation.relname = current_schema() || '_' || suffixes.suffix
      LEFT JOIN pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
        AND namespace.nspname = current_schema()
      LEFT JOIN pg_index AS index_record
        ON index_record.indexrelid = relation.oid
    `.execute(tenantDb);
    return (
      result.rows.length === requiredSuffixes.length &&
      result.rows.every(({ valid }) => valid)
    );
  } catch {
    return false;
  }
}
