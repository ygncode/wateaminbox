import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import { executeOnAllTenants } from './migration-helpers.js'

/**
 * Migration 029: Add UNIQUE constraint to message_reactions table
 *
 * WhatsApp behavior: One reaction per user per message.
 * If a user reacts again, it should replace their previous reaction.
 *
 * This migration:
 * 1. Removes duplicate reactions (keeping the most recent one)
 * 2. Adds a UNIQUE constraint on (message_id, reactor_jid)
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    // Create a safe schema name for constraint naming
    const safeSchemaName = schemaName.replace(/-/g, '_')

    // Check if constraint already exists
    const constraintExists = await sql<{ exists: boolean }>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_schema = ${schemaName}
        AND table_name = 'message_reactions'
        AND constraint_name = ${safeSchemaName + '_message_reactions_unique'}
      ) as exists
    `.execute(db)

    if (constraintExists.rows[0]?.exists) {
      console.log(`Constraint already exists in ${schemaName}, skipping...`)
      return
    }

    // Step 1: Remove duplicate reactions, keeping the most recent one
    // This uses a CTE to identify duplicates and deletes all but the latest
    console.log(`Removing duplicate reactions in ${schemaName}...`)
    await sql`
      DELETE FROM ${sql.raw(`"${schemaName}".message_reactions`)} mr
      WHERE mr.id NOT IN (
        SELECT DISTINCT ON (message_id, reactor_jid) id
        FROM ${sql.raw(`"${schemaName}".message_reactions`)}
        ORDER BY message_id, reactor_jid, created_at DESC
      )
    `.execute(db)

    // Step 2: Add the UNIQUE constraint
    console.log(`Adding UNIQUE constraint in ${schemaName}...`)
    await sql`
      ALTER TABLE ${sql.raw(`"${schemaName}".message_reactions`)}
      ADD CONSTRAINT ${sql.raw(`"${safeSchemaName}_message_reactions_unique"`)}
      UNIQUE (message_id, reactor_jid)
    `.execute(db)

    console.log(`Added UNIQUE constraint to ${schemaName}.message_reactions`)
  })
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    const safeSchemaName = schemaName.replace(/-/g, '_')

    await sql`
      ALTER TABLE ${sql.raw(`"${schemaName}".message_reactions`)}
      DROP CONSTRAINT IF EXISTS ${sql.raw(`"${safeSchemaName}_message_reactions_unique"`)}
    `.execute(db)

    console.log(`Removed UNIQUE constraint from ${schemaName}.message_reactions`)
  })
}
