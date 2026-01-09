import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import { addColumnToAllTenants, executeOnAllTenants } from './migration-helpers.js'

/**
 * Migration 024: Add sync_status column to whatsapp_connections
 *
 * This migration adds a column to track WhatsApp history sync status
 * after initial connection. Enables UI to show syncing overlay until
 * history sync completes.
 *
 * New column on whatsapp_connections table:
 * - sync_status: 'syncing' | 'completed' | 'interrupted' | null
 *   - null: Not started or unknown
 *   - 'syncing': Currently syncing history
 *   - 'completed': History sync completed
 *   - 'interrupted': Sync was interrupted by disconnection
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  console.log('Migration 024: Adding sync_status column to whatsapp_connections...')

  // Add sync_status column to whatsapp_connections table in all tenant schemas
  await addColumnToAllTenants(
    db,
    'whatsapp_connections',
    'sync_status',
    'VARCHAR(20)',
  )

  console.log('Migration 024: Completed adding sync_status column')
}

export async function down(db: Kysely<unknown>): Promise<void> {
  console.log('Migration 024: Removing sync_status column from whatsapp_connections...')

  // Remove sync_status column from all tenant schemas
  await executeOnAllTenants(db, async (schemaName) => {
    await sql`
      ALTER TABLE ${sql.raw(`"${schemaName}".whatsapp_connections`)}
      DROP COLUMN IF EXISTS sync_status
    `.execute(db)
  })

  console.log('Migration 024: Completed removing sync_status column')
}
