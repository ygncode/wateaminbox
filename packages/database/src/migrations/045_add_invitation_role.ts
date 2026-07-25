import { Kysely, sql } from 'kysely'

/** Preserve the role selected by an inviter until the invitation is accepted. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('invitations')
    .addColumn('role', sql`member_role`, (col) =>
      col.notNull().defaultTo('member'),
    )
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('invitations').dropColumn('role').execute()
}
