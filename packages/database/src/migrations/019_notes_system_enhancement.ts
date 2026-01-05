import type { Kysely } from "kysely";
import { sql } from "kysely";
import {
  executeOnAllTenants,
  getTenantSchemas,
} from "./migration-helpers.js";

/**
 * Migration 019: Notes System Enhancement
 *
 * This migration:
 * 1. Creates contact_notes_shared table for multiple shared notes per contact
 * 2. Migrates existing notes_shared data from contacts table
 * 3. Removes unique constraint from contact_notes_private to allow multiple notes per user
 *
 * NOTE: Also update the setup_tenant_schema function in migration 015 for NEW tenants.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const schemas = await getTenantSchemas(db);

  console.log(`Found ${schemas.length} tenant schemas to update`);

  for (const schemaName of schemas) {
    console.log(`Updating tenant schema: ${schemaName}`);

    // 1. Create contact_notes_shared table
    await sql`
      CREATE TABLE IF NOT EXISTS ${sql.raw(`"${schemaName}".contact_notes_shared`)} (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        contact_id UUID NOT NULL,
        user_id UUID NOT NULL,
        author_name VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
      )
    `.execute(db);

    // Create indexes for contact_notes_shared
    const safeSchemaName = schemaName.replace(/-/g, "_").substring(0, 40);
    await sql`
      CREATE INDEX IF NOT EXISTS ${sql.raw(`"${safeSchemaName}_shared_notes_contact_idx"`)}
      ON ${sql.raw(`"${schemaName}".contact_notes_shared`)} (contact_id)
    `.execute(db);

    await sql`
      CREATE INDEX IF NOT EXISTS ${sql.raw(`"${safeSchemaName}_shared_notes_user_idx"`)}
      ON ${sql.raw(`"${schemaName}".contact_notes_shared`)} (user_id)
    `.execute(db);

    await sql`
      CREATE INDEX IF NOT EXISTS ${sql.raw(`"${safeSchemaName}_shared_notes_created_idx"`)}
      ON ${sql.raw(`"${schemaName}".contact_notes_shared`)} (contact_id, created_at DESC)
    `.execute(db);

    // 2. Migrate existing notes_shared data from contacts table
    // Check if notes_shared column exists in contacts table
    const notesSharedExists = await sql<{ exists: boolean }>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = ${schemaName}
        AND table_name = 'contacts'
        AND column_name = 'notes_shared'
      ) as exists
    `.execute(db);

    if (notesSharedExists.rows[0]?.exists) {
      // Migrate existing notes to contact_notes_shared
      // We use 'System' as author_name and a system UUID for migrated notes
      await sql`
        INSERT INTO ${sql.raw(`"${schemaName}".contact_notes_shared`)}
          (contact_id, user_id, author_name, content, created_at, updated_at)
        SELECT
          id as contact_id,
          '00000000-0000-0000-0000-000000000000'::UUID as user_id,
          'System' as author_name,
          notes_shared as content,
          updated_at as created_at,
          updated_at
        FROM ${sql.raw(`"${schemaName}".contacts`)}
        WHERE notes_shared IS NOT NULL AND notes_shared != ''
      `.execute(db);

      console.log(`Migrated notes_shared data for schema ${schemaName}`);
    }

    // 3. Drop unique constraint from contact_notes_private if it exists
    // First check if the table exists
    const tableExists = await sql<{ exists: boolean }>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = ${schemaName}
        AND table_name = 'contact_notes_private'
      ) as exists
    `.execute(db);

    if (tableExists.rows[0]?.exists) {
      // Check if the constraint exists
      const constraintExists = await sql<{ count: string }>`
        SELECT COUNT(*) as count
        FROM information_schema.table_constraints
        WHERE table_schema = ${schemaName}
        AND table_name = 'contact_notes_private'
        AND constraint_type = 'UNIQUE'
        AND constraint_name LIKE '%contact_id%user_id%'
      `.execute(db);

      if (parseInt(constraintExists.rows[0]?.count || "0") > 0) {
        // Get the actual constraint name
        const constraintName = await sql<{ constraint_name: string }>`
          SELECT constraint_name
          FROM information_schema.table_constraints
          WHERE table_schema = ${schemaName}
          AND table_name = 'contact_notes_private'
          AND constraint_type = 'UNIQUE'
          AND constraint_name LIKE '%contact_id%user_id%'
          LIMIT 1
        `.execute(db);

        if (constraintName.rows[0]?.constraint_name) {
          await sql`
            ALTER TABLE ${sql.raw(`"${schemaName}".contact_notes_private`)}
            DROP CONSTRAINT IF EXISTS ${sql.raw(`"${constraintName.rows[0].constraint_name}"`)}
          `.execute(db);
          console.log(
            `Dropped unique constraint from ${schemaName}.contact_notes_private`
          );
        }
      }
    } else {
      console.log(
        `Skipping constraint drop - contact_notes_private table does not exist in ${schemaName}`
      );
    }

    // 4. Add indexes to contact_notes_private if table exists
    if (tableExists.rows[0]?.exists) {
      await sql`
        CREATE INDEX IF NOT EXISTS ${sql.raw(`"${safeSchemaName}_private_notes_contact_user_idx"`)}
        ON ${sql.raw(`"${schemaName}".contact_notes_private`)} (contact_id, user_id)
      `.execute(db);

      await sql`
        CREATE INDEX IF NOT EXISTS ${sql.raw(`"${safeSchemaName}_private_notes_created_idx"`)}
        ON ${sql.raw(`"${schemaName}".contact_notes_private`)} (contact_id, created_at DESC)
      `.execute(db);
    }
  }

  console.log("Migration 019 completed: Notes system enhancement");
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Note: We cannot easily restore the notes_shared column data
  // This down migration only removes the new table structure

  await executeOnAllTenants(db, async (schemaName) => {
    // Drop the contact_notes_shared table
    await sql`
      DROP TABLE IF EXISTS ${sql.raw(`"${schemaName}".contact_notes_shared`)}
    `.execute(db);
    console.log(`Dropped contact_notes_shared table from ${schemaName}`);
  });
}
