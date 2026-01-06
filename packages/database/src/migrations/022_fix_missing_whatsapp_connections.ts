import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import { getTenantSchemas } from './migration-helpers.js'

/**
 * Migration 022: Fix missing whatsapp_connections table in tenant schemas
 *
 * Some tenant schemas may be missing the whatsapp_connections table due to
 * a logic gap in migration 015 - if the messages table existed but
 * whatsapp_connections didn't, the full setup was skipped.
 *
 * This migration checks each tenant schema and creates the table if missing.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const schemas = await getTenantSchemas(db)

  for (const schemaName of schemas) {
    // Check if whatsapp_connections table exists
    const tableExists = await sql<{ exists: string }>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = ${schemaName}
        AND table_name = 'whatsapp_connections'
      ) as exists
    `.execute(db)

    if (!tableExists.rows[0]?.exists || tableExists.rows[0].exists !== 't') {
      console.log(`Creating whatsapp_connections table in ${schemaName}`)

      // Create the whatsapp_connections table
      await sql`
        CREATE TABLE ${sql.raw(`"${schemaName}".whatsapp_connections`)} (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(255),
          phone_number VARCHAR(20),
          jid VARCHAR(100),
          status VARCHAR(20) DEFAULT 'disconnected',
          connected_by UUID REFERENCES public.users(id),
          connected_at TIMESTAMPTZ,
          last_sync_at TIMESTAMPTZ,
          connection_order INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT now(),
          updated_at TIMESTAMPTZ DEFAULT now()
        )
      `.execute(db)

      // Create index on status for faster queries
      await sql`
        CREATE INDEX ${sql.raw(`"${schemaName}_whatsapp_connections_status_idx"`)}
        ON ${sql.raw(`"${schemaName}".whatsapp_connections`)}(status)
      `.execute(db)

      console.log(`Created whatsapp_connections table in ${schemaName}`)
    }
  }

  console.log('Migration 022: Completed checking/creating whatsapp_connections tables')
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Cannot safely drop tables that may contain data
  console.log('Migration 022 cannot be rolled back - whatsapp_connections tables should persist')
}
