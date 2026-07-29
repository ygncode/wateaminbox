import { type Kysely, sql } from "kysely";

/** Preserve owner-selected access overrides until an invitation is accepted. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("invitations")
    .addColumn("permissions", "jsonb", (column) =>
      column.notNull().defaultTo(sql`'{}'::jsonb`),
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("invitations").dropColumn("permissions").execute();
}
