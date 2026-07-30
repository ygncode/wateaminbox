import { type Kysely, sql } from "kysely";
import { executeOnAllTenants } from "./migration-helpers.js";

/**
 * Allow scheduled messages to carry a media attachment. media_url stores the
 * API-issued presigned URL exactly as the immediate-send path does — the
 * dispatcher re-derives the durable object key from it, so URL signature
 * expiry does not matter. Mime type and filename are captured at schedule
 * time so the UI can label the attachment without object-storage roundtrips.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    await sql`
      ALTER TABLE ${sql.table(`${schemaName}.scheduled_messages`)}
      ADD COLUMN IF NOT EXISTS media_url TEXT,
      ADD COLUMN IF NOT EXISTS media_mime_type TEXT,
      ADD COLUMN IF NOT EXISTS media_file_name TEXT
    `.execute(db);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    await sql`
      ALTER TABLE ${sql.table(`${schemaName}.scheduled_messages`)}
      DROP COLUMN IF EXISTS media_url,
      DROP COLUMN IF EXISTS media_mime_type,
      DROP COLUMN IF EXISTS media_file_name
    `.execute(db);
  });
}
