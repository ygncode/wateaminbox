import type { Kysely } from "kysely";
import { sql } from "kysely";

/**
 * Durable lease heartbeats for orchestrator nodes.
 *
 * Each orchestrator instance registers its node identity here and renews an
 * expiry-based lease. Registration refuses a node identity whose lease is
 * still live, which enforces the per-node stop-first constraint in shared
 * state. A peer may take over a node's workers only after that node's lease
 * has been expired for a safety margin, so the previous owner has provably
 * self-fenced (or, on Linux, its workers died with it via parent-death
 * SIGKILL).
 *
 * Rows are never deleted automatically: a node that once existed keeps its
 * row, and takeover deliberately requires an expired lease row rather than a
 * missing one, so a binary that predates leases can never have its workers
 * silently stolen.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("orchestrator_nodes")
    .ifNotExists()
    .addColumn("node_id", "varchar(64)", (column) => column.primaryKey())
    .addColumn("lease_expires_at", "timestamptz", (column) => column.notNull())
    .addColumn("heartbeat_at", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addColumn("started_at", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    // Per-node worker capacity, recorded at registration so a full node can
    // place a brand-new connection on a live peer with free slots. 0 means
    // unlimited.
    .addColumn("max_workers", "integer", (column) =>
      column.notNull().defaultTo(0),
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("orchestrator_nodes").ifExists().execute();
}
