import { sql, type Kysely } from 'kysely'

/** Worker processes now receive DATABASE_URL from orchestrator configuration. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`UPDATE worker_registry SET database_url = '' WHERE database_url <> ''`.execute(db)
}

export async function down(_db: Kysely<unknown>): Promise<void> {
  // Credentials cannot and should not be reconstructed.
}
