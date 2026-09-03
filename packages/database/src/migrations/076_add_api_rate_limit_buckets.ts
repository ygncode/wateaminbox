import type { Kysely } from "kysely";
import { sql } from "kysely";

/**
 * Shared fixed-window counters for API replicas.
 *
 * `bucket_key` includes the middleware namespace and subject. Expiration is
 * stored explicitly so request-path increments and bounded background cleanup
 * can both use PostgreSQL's clock rather than replica clocks.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("api_rate_limit_buckets")
    .ifNotExists()
    .addColumn("bucket_key", "text", (column) => column.primaryKey())
    .addColumn("request_count", "bigint", (column) =>
      column.notNull().check(sql`request_count >= 1`),
    )
    .addColumn("window_started_at", "timestamptz", (column) => column.notNull())
    .addColumn("expires_at", "timestamptz", (column) => column.notNull())
    .execute();

  await db.schema
    .createIndex("api_rate_limit_buckets_expires_at_idx")
    .ifNotExists()
    .on("api_rate_limit_buckets")
    .column("expires_at")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("api_rate_limit_buckets").ifExists().execute();
}
