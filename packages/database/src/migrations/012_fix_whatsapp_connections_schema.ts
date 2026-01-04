import type { Kysely } from "kysely";
import { sql } from "kysely";

/**
 * Migration 012: Fix whatsapp_connections schema in existing tenants
 *
 * This migration fixes tenant schemas that were created with migration 011's old version
 * which incorrectly included session_data and was missing connection_order.
 *
 * Changes:
 * 1. Adds connection_order column to existing tenant schemas
 * 2. Removes session_data column from existing tenant schemas (moved to whatsapp_sessions schema in migration 009)
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // Get all tenant schemas
  const schemas = await sql<{ schema_name: string }>`
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name LIKE 'tenant_%'
  `.execute(db);

  for (const { schema_name } of schemas.rows) {
    // Add connection_order column if not exists
    const connectionOrderExists = await sql<{ exists: boolean }>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = ${schema_name}
        AND table_name = 'whatsapp_connections'
        AND column_name = 'connection_order'
      ) as exists
    `.execute(db);

    if (!connectionOrderExists.rows[0]?.exists) {
      await sql`
        ALTER TABLE ${sql.raw(`"${schema_name}".whatsapp_connections`)}
        ADD COLUMN connection_order INTEGER DEFAULT 0
      `.execute(db);

      console.log(`Added connection_order column to ${schema_name}.whatsapp_connections`);
    }

    // Remove session_data column if exists
    const sessionDataExists = await sql<{ exists: boolean }>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = ${schema_name}
        AND table_name = 'whatsapp_connections'
        AND column_name = 'session_data'
      ) as exists
    `.execute(db);

    if (sessionDataExists.rows[0]?.exists) {
      await sql`
        ALTER TABLE ${sql.raw(`"${schema_name}".whatsapp_connections`)}
        DROP COLUMN session_data
      `.execute(db);

      console.log(`Removed session_data column from ${schema_name}.whatsapp_connections`);
    }
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Get all tenant schemas
  const schemas = await sql<{ schema_name: string }>`
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name LIKE 'tenant_%'
  `.execute(db);

  for (const { schema_name } of schemas.rows) {
    // Add back session_data column
    await sql`
      ALTER TABLE ${sql.raw(`"${schema_name}".whatsapp_connections`)}
      ADD COLUMN IF NOT EXISTS session_data BYTEA
    `.execute(db);

    // Remove connection_order column
    await sql`
      ALTER TABLE ${sql.raw(`"${schema_name}".whatsapp_connections`)}
      DROP COLUMN IF EXISTS connection_order
    `.execute(db);
  }
}
