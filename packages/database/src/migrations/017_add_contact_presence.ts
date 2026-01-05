import type { Kysely } from "kysely";
import { sql } from "kysely";
import { addColumnToAllTenants, executeOnAllTenants } from "./migration-helpers.js";

/**
 * Migration 017: Add contact presence tracking
 *
 * PURPOSE:
 * Add columns to track WhatsApp contact presence (online/offline status and last seen)
 * This enables real-time status updates when contacts come online or go offline.
 *
 * CHANGES:
 * 1. Add is_online column to contacts table (boolean, default false)
 * 2. Add last_seen column to contacts table (timestamptz, nullable)
 * 3. Add presence index for performance
 *
 * NOTE: The setup_tenant_schema function in migration 015 has been updated to include
 * these columns for NEW tenants. This migration only updates EXISTING tenant schemas.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  console.log("Adding presence columns to contacts table in all tenant schemas...");

  // Add is_online column to all existing tenant schemas
  await addColumnToAllTenants(
    db,
    "contacts",
    "is_online",
    "BOOLEAN DEFAULT false NOT NULL",
  );

  // Add last_seen column to all existing tenant schemas
  await addColumnToAllTenants(
    db,
    "contacts",
    "last_seen",
    "TIMESTAMPTZ",
  );

  console.log("Adding performance index for presence queries...");

  // Add index for presence queries (filtering by is_online, sorting by last_seen)
  // This helps queries that need to show online contacts or sort by last seen time
  await executeOnAllTenants(db, async (schemaName) => {
    const safeSchemaName = schemaName.replace(/-/g, "_");
    const indexName = `idx_${safeSchemaName.substring(0, 40)}_contacts_presence`;

    await sql`
      CREATE INDEX IF NOT EXISTS ${sql.raw(indexName)}
      ON ${sql.raw(`"${schemaName}".contacts`)} (is_online, last_seen DESC NULLS LAST)
    `.execute(db);
  });

  console.log("Contact presence columns added successfully!");
}

export async function down(db: Kysely<unknown>): Promise<void> {
  console.log("Removing presence columns from contacts table in all tenant schemas...");

  // Get all tenant schemas
  const schemas = await sql<{ schema_name: string }>`
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name LIKE 'tenant_%'
    ORDER BY schema_name
  `.execute(db);

  // Remove columns from each tenant schema
  for (const { schema_name } of schemas.rows) {
    console.log(`Removing presence columns from ${schema_name}.contacts`);

    await sql`
      ALTER TABLE ${sql.raw(`"${schema_name}".contacts`)}
      DROP COLUMN IF EXISTS is_online,
      DROP COLUMN IF EXISTS last_seen
    `.execute(db);
  }

  console.log("Contact presence columns removed successfully!");
}
