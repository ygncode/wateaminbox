import {
  getTenantSchemaName,
  type TenantDatabase,
} from "@wateaminbox/database";
import type { Kysely, Transaction } from "kysely";
import { sql } from "kysely";

const requiredSuffixes = [
  "msg_external_uidx",
  "msg_idempotency_uidx",
  "mr_external_uidx",
  "ma_fetch_due_idx",
  "ca_conversation_uidx",
  "cc_conversation_uidx",
  "cs_conversation_uidx",
] as const;

/**
 * Provider enablement fails closed until every online index build completed.
 *
 * The names are the bare suffixes the index runner creates. They are unique
 * without a schema prefix because they live in the tenant schema, and a
 * prefix could not be used anyway: `tenant_<uuid>_` is 43 characters, so
 * `tenant_<uuid>_msg_idempotency_uidx` is 64 and PostgreSQL would silently
 * truncate it at 63. Looking for a prefixed name here matched nothing, which
 * held every workspace at "storage not ready" no matter how many times the
 * reconciler ran.
 *
 * The schema is derived from the workspace rather than read from
 * `current_schema()`. Tenant handles are scoped with Kysely's `withSchema()`
 * and never set a per-connection `search_path`, so `current_schema()` on one
 * is always `public` - it named the wrong schema on every call.
 *
 * The lookup is a correlated subquery rather than a chain of LEFT JOINs so
 * that the schema filter actually restricts the match. As a join condition it
 * did not: every tenant schema holds an index of the same bare name, so the
 * rows fanned out across all of them, and another workspace's index could
 * have answered for this one.
 */
export async function isChannelSpineTenantReady(
  tenantDb: Kysely<TenantDatabase> | Transaction<TenantDatabase>,
  companyId: string,
): Promise<boolean> {
  const schemaName = getTenantSchemaName(companyId);
  try {
    const result = await sql<{ suffix: string; valid: boolean }>`
      SELECT suffixes.suffix,
        COALESCE((
          SELECT index_record.indisvalid
          FROM pg_class AS relation
          JOIN pg_namespace AS namespace
            ON namespace.oid = relation.relnamespace
          JOIN pg_index AS index_record
            ON index_record.indexrelid = relation.oid
          WHERE namespace.nspname = ${schemaName}
            AND relation.relname = suffixes.suffix
        ), false) AS valid
      FROM unnest(${requiredSuffixes}::text[]) AS suffixes(suffix)
    `.execute(tenantDb);
    return (
      result.rows.length === requiredSuffixes.length &&
      result.rows.every(({ valid }) => valid)
    );
  } catch {
    return false;
  }
}
