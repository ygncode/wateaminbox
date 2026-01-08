import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import { executeOnAllTenants } from './migration-helpers.js'

/**
 * Migration 027: Add UNIQUE constraint for message deduplication
 *
 * This migration prevents duplicate messages by adding a UNIQUE constraint
 * on (whatsapp_connection_id, message_id) to the messages table.
 *
 * Why this is needed:
 * - During history sync, the same message could be processed multiple times
 * - NATS message retries could cause duplicate message events
 * - Parallel processing in Go service could send same message twice
 * - Race conditions between history sync and real-time messages
 *
 * The constraint ensures that each WhatsApp message_id is stored only once
 * per connection, making message insertion idempotent.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  console.log('Migration 027: Adding message deduplication constraint...')

  // First, we need to remove any existing duplicates before adding the constraint
  await executeOnAllTenants(db, async (schemaName) => {
    // Find and delete duplicate messages, keeping only the first occurrence (by created_at)
    // This query identifies duplicates by (whatsapp_connection_id, message_id)
    // and keeps the oldest one based on created_at
    await sql`
      DELETE FROM ${sql.raw(`"${schemaName}".messages`)}
      WHERE id IN (
        SELECT id
        FROM (
          SELECT id,
            ROW_NUMBER() OVER (
              PARTITION BY whatsapp_connection_id, message_id
              ORDER BY created_at ASC
            ) AS rn
          FROM ${sql.raw(`"${schemaName}".messages`)}
          WHERE message_id IS NOT NULL
        ) t
        WHERE t.rn > 1
      )
    `.execute(db)

    console.log(`Removed duplicate messages in ${schemaName}`)
  })

  // Now add the UNIQUE constraint to prevent future duplicates
  await executeOnAllTenants(db, async (schemaName) => {
    await sql`
      ALTER TABLE ${sql.raw(`"${schemaName}".messages`)}
      ADD CONSTRAINT ${sql.raw(`"${schemaName}_messages_unique_wa_message"`)}
      UNIQUE (whatsapp_connection_id, message_id)
    `.execute(db)

    console.log(`Added UNIQUE constraint in ${schemaName}`)
  })

  console.log('Migration 027: Completed adding message deduplication constraint')
}

export async function down(db: Kysely<unknown>): Promise<void> {
  console.log('Migration 027: Removing message deduplication constraint...')

  // Remove the UNIQUE constraint
  await executeOnAllTenants(db, async (schemaName) => {
    await sql`
      ALTER TABLE ${sql.raw(`"${schemaName}".messages`)}
      DROP CONSTRAINT IF EXISTS ${sql.raw(`"${schemaName}_messages_unique_wa_message"`)}
    `.execute(db)

    console.log(`Removed UNIQUE constraint in ${schemaName}`)
  })

  console.log('Migration 027: Completed removing message deduplication constraint')
}
