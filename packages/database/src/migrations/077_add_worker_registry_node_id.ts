import type { Kysely } from "kysely";

/**
 * Record which orchestrator node owns each worker launch.
 *
 * The column is nullable: rows written before this migration have no owner
 * yet. The first orchestrator to start after the migration adopts unassigned
 * rows atomically (node_id IS NULL is the compare-and-swap predicate), so a
 * single-host deployment upgrades without operator action while two nodes can
 * never both adopt the same row.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("worker_registry")
    .addColumn("node_id", "varchar(64)")
    .execute();

  await db.schema
    .createIndex("worker_registry_node_id_idx")
    .ifNotExists()
    .on("worker_registry")
    .column("node_id")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .dropIndex("worker_registry_node_id_idx")
    .ifExists()
    .execute();
  await db.schema.alterTable("worker_registry").dropColumn("node_id").execute();
}
