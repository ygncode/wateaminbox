import { type Kysely, sql } from "kysely";
import { executeOnAllTenants } from "./migration-helpers.js";

/** Persist history-sync progress so browser refreshes can restore live counts. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    await sql`
      ALTER TABLE ${sql.raw(`"${schemaName}".whatsapp_connections`)}
      ADD COLUMN IF NOT EXISTS sync_message_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS sync_conversation_count INTEGER NOT NULL DEFAULT 0
    `.execute(db);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    await sql`
      ALTER TABLE ${sql.raw(`"${schemaName}".whatsapp_connections`)}
      DROP COLUMN IF EXISTS sync_message_count,
      DROP COLUMN IF EXISTS sync_conversation_count
    `.execute(db);
  });
}
