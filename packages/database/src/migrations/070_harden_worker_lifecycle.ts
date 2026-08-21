import { type Kysely, sql } from "kysely";

/**
 * Give every persisted worker launch an immutable generation and record the
 * operator's desired state separately from its observed process status.
 *
 * Existing rows represent workers that were intended to run, so the safe
 * backfill/default is running. gen_random_uuid() gives each legacy row a unique
 * launch identity before either column becomes NOT NULL.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("worker_registry")
    .addColumn("launch_id", "uuid", (col) =>
      col.notNull().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("desired_state", "varchar(20)", (col) =>
      col.notNull().defaultTo("running"),
    )
    .execute();

  await db.schema
    .alterTable("worker_registry")
    .addCheckConstraint(
      "worker_registry_desired_state_check",
      sql`desired_state IN ('running', 'stopped', 'unlinking')`,
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("worker_registry")
    .dropConstraint("worker_registry_desired_state_check")
    .execute();
  await db.schema
    .alterTable("worker_registry")
    .dropColumn("desired_state")
    .dropColumn("launch_id")
    .execute();
}
