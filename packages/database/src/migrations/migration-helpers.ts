import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * Migration helper utilities for multi-tenant database schema management.
 *
 * IMPORTANT: Every migration that modifies tenant schemas must:
 * 1. Apply the change to ALL existing tenant schemas
 * 2. Update the setup_tenant_schema function ONLY in migration 002 or 003
 *
 * Do NOT use CREATE OR REPLACE FUNCTION setup_tenant_schema in later migrations.
 * Instead, keep the function in 002/003 as the "source of truth" and update it there.
 */

/**
 * Get all tenant schema names from the database
 */
export async function getTenantSchemas(
  db: Kysely<unknown>,
): Promise<string[]> {
  const result = await sql<{ schema_name: string }>`
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name LIKE 'tenant_%'
    ORDER BY schema_name
  `.execute(db)

  return result.rows.map((r) => r.schema_name)
}

/**
 * Execute SQL against all tenant schemas
 * Use this for schema changes like ALTER TABLE, CREATE INDEX, etc.
 */
export async function executeOnAllTenants(
  db: Kysely<unknown>,
  callback: (schemaName: string) => Promise<void>,
): Promise<void> {
  const schemas = await getTenantSchemas(db)

  for (const schemaName of schemas) {
    try {
      await callback(schemaName)
    } catch (error) {
      console.error(
        `Migration failed for tenant schema ${schemaName}:`,
        error,
      )
      throw error
    }
  }
}

/**
 * Add a column to a table in all tenant schemas if it doesn't exist
 */
export async function addColumnToAllTenants(
  db: Kysely<unknown>,
  tableName: string,
  columnName: string,
  columnDefinition: string,
): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    // Check if column exists
    const exists = await sql<{ exists: string }>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = ${schemaName}
        AND table_name = ${tableName}
        AND column_name = ${columnName}
      ) as exists
    `.execute(db)

    if (!exists.rows[0]?.exists || exists.rows[0].exists !== 't') {
      await sql`
        ALTER TABLE ${sql.raw(`"${schemaName}"."${tableName}"`)}
        ADD COLUMN IF NOT EXISTS ${sql.raw(`${columnName} ${columnDefinition}`)}
      `.execute(db)
      console.log(
        `Added column ${columnName} to ${schemaName}.${tableName}`,
      )
    }
  })
}

/**
 * Drop a column from a table in all tenant schemas if it exists
 */
export async function dropColumnFromAllTenants(
  db: Kysely<unknown>,
  tableName: string,
  columnName: string,
): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    await sql`
      ALTER TABLE ${sql.raw(`"${schemaName}"."${tableName}"`)}
      DROP COLUMN IF EXISTS ${sql.raw(columnName)}
    `.execute(db)
    console.log(
      `Dropped column ${columnName} from ${schemaName}.${tableName}`,
    )
  })
}

/**
 * Create an index on a table in all tenant schemas if it doesn't exist
 */
export async function createIndexOnAllTenants(
  db: Kysely<unknown>,
  indexName: (schemaName: string) => string,
  tableName: string,
  indexDefinition: string,
): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    const idxName = indexName(schemaName)
    await sql`
      CREATE INDEX IF NOT EXISTS ${sql.raw(`"${idxName}"`)}
      ON ${sql.raw(`"${schemaName}"."${tableName}"`)} ${sql.raw(
      indexDefinition,
    )}
    `.execute(db)
    console.log(`Created index ${idxName} on ${schemaName}.${tableName}`)
  })
}

/**
 * Create a unique index on a table in all tenant schemas if it doesn't exist
 */
export async function createUniqueIndexOnAllTenants(
  db: Kysely<unknown>,
  indexName: (schemaName: string) => string,
  tableName: string,
  indexDefinition: string,
): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    const idxName = indexName(schemaName)
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS ${sql.raw(`"${idxName}"`)}
      ON ${sql.raw(`"${schemaName}"."${tableName}"`)} ${sql.raw(
      indexDefinition,
    )}
    `.execute(db)
    console.log(
      `Created unique index ${idxName} on ${schemaName}.${tableName}`,
    )
  })
}

/**
 * Rename a column in a table in all tenant schemas
 */
export async function renameColumnInAllTenants(
  db: Kysely<unknown>,
  tableName: string,
  oldColumnName: string,
  newColumnName: string,
): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    await sql`
      ALTER TABLE ${sql.raw(`"${schemaName}"."${tableName}"`)}
      RENAME COLUMN ${sql.raw(oldColumnName)} TO ${sql.raw(newColumnName)}
    `.execute(db)
    console.log(
      `Renamed column ${oldColumnName} to ${newColumnName} in ${schemaName}.${tableName}`,
    )
  })
}

/**
 * Create a table in all tenant schemas if it doesn't exist
 */
export async function createTableInAllTenants(
  db: Kysely<unknown>,
  tableDefinition: (schemaName: string) => string,
): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    const definition = tableDefinition(schemaName)
    await sql.raw(definition).execute(db)
    console.log(`Created table in ${schemaName}`)
  })
}

/**
 * Execute a raw SQL statement against all tenant schemas
 */
export async function executeSqlOnAllTenants(
  db: Kysely<unknown>,
  sqlStatement: (schemaName: string) => string,
): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    await sql.raw(sqlStatement(schemaName)).execute(db)
  })
}

/**
 * Check if a column exists in any tenant schema
 * Useful for conditional migrations
 */
export async function columnExistsInTenants(
  db: Kysely<unknown>,
  tableName: string,
  columnName: string,
): Promise<boolean> {
  const schemas = await getTenantSchemas(db)

  for (const schemaName of schemas) {
    const exists = await sql<{ exists: string }>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = ${schemaName}
        AND table_name = ${tableName}
        AND column_name = ${columnName}
      ) as exists
    `.execute(db)

    if (exists.rows[0]?.exists === 't') {
      return true
    }
  }

  return false
}

/**
 * Log migration progress for tenant schemas
 */
export function logTenantMigration(
  action: string,
  schemaName: string,
  details?: string,
): void {
  if (details) {
    console.log(`[Tenant Migration] ${action} - ${schemaName}: ${details}`)
  } else {
    console.log(`[Tenant Migration] ${action} - ${schemaName}`)
  }
}
