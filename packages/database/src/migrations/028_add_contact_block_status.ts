import type { Kysely } from 'kysely'
import {
  addColumnToAllTenants,
  dropColumnFromAllTenants,
} from './migration-helpers.js'

/**
 * Migration 028: Add is_blocked column to contacts table
 *
 * This migration adds support for blocking/unblocking WhatsApp contacts.
 * The is_blocked field is stored locally first, then synced to WhatsApp.
 *
 * The column is added to:
 * - All existing tenant schemas via addColumnToAllTenants()
 * - New tenant schemas via setup_tenant_schema (updated in migration 015)
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  console.log('Migration 028: Adding is_blocked column to contacts table...')

  // Add is_blocked column to all existing tenant schemas
  await addColumnToAllTenants(
    db,
    'contacts',
    'is_blocked',
    'BOOLEAN DEFAULT false NOT NULL'
  )

  console.log('Migration 028: Completed adding is_blocked column')
}

export async function down(db: Kysely<unknown>): Promise<void> {
  console.log('Migration 028: Removing is_blocked column from contacts table...')

  // Remove is_blocked column from all tenant schemas
  await dropColumnFromAllTenants(db, 'contacts', 'is_blocked')

  console.log('Migration 028: Completed removing is_blocked column')
}
