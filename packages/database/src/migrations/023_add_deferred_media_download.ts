import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import {
  addColumnToAllTenants,
  executeOnAllTenants,
} from './migration-helpers.js'

/**
 * Migration 023: Add deferred media download support
 *
 * This migration adds columns to store WhatsApp media references
 * so media can be downloaded on-demand rather than during history sync.
 *
 * New columns on messages table:
 * - media_direct_path: WhatsApp CDN direct path
 * - media_key: AES encryption key for decrypting the media
 * - media_file_sha256: Original file hash for verification
 * - media_file_enc_sha256: Encrypted file hash
 * - media_download_status: pending|downloading|completed|failed
 * - media_download_error: Error message if download failed
 * - media_downloaded_at: Timestamp when media was downloaded
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  console.log('Migration 023: Adding deferred media download columns...')

  // Add media reference columns to messages table in all tenant schemas
  await addColumnToAllTenants(
    db,
    'messages',
    'media_direct_path',
    'TEXT',
  )

  await addColumnToAllTenants(
    db,
    'messages',
    'media_key',
    'BYTEA',
  )

  await addColumnToAllTenants(
    db,
    'messages',
    'media_file_sha256',
    'BYTEA',
  )

  await addColumnToAllTenants(
    db,
    'messages',
    'media_file_enc_sha256',
    'BYTEA',
  )

  await addColumnToAllTenants(
    db,
    'messages',
    'media_download_status',
    "VARCHAR(20) DEFAULT NULL",
  )

  await addColumnToAllTenants(
    db,
    'messages',
    'media_download_error',
    'TEXT',
  )

  await addColumnToAllTenants(
    db,
    'messages',
    'media_downloaded_at',
    'TIMESTAMPTZ',
  )

  // Create partial index for pending media downloads queue
  // This makes it efficient to query messages that need media downloaded
  await executeOnAllTenants(db, async (schemaName) => {
    await sql`
      CREATE INDEX IF NOT EXISTS ${sql.raw(`"${schemaName}_idx_messages_media_pending"`)}
      ON ${sql.raw(`"${schemaName}".messages`)} (media_download_status, created_at)
      WHERE media_download_status = 'pending' AND media_direct_path IS NOT NULL
    `.execute(db)
    console.log(`Created pending media index in ${schemaName}`)
  })

  console.log('Migration 023: Completed adding deferred media download columns')
}

export async function down(db: Kysely<unknown>): Promise<void> {
  console.log('Migration 023: Removing deferred media download columns...')

  // Drop the partial index first
  await executeOnAllTenants(db, async (schemaName) => {
    await sql`
      DROP INDEX IF EXISTS ${sql.raw(`"${schemaName}"."${schemaName}_idx_messages_media_pending"`)}
    `.execute(db)
  })

  // Remove columns (in reverse order of addition)
  const columns = [
    'media_downloaded_at',
    'media_download_error',
    'media_download_status',
    'media_file_enc_sha256',
    'media_file_sha256',
    'media_key',
    'media_direct_path',
  ]

  for (const column of columns) {
    await executeOnAllTenants(db, async (schemaName) => {
      await sql`
        ALTER TABLE ${sql.raw(`"${schemaName}".messages`)}
        DROP COLUMN IF EXISTS ${sql.raw(column)}
      `.execute(db)
    })
  }

  console.log('Migration 023: Completed removing deferred media download columns')
}
