import { Kysely, sql, PostgresDialect } from "kysely";
import { Pool as PgPool } from "pg";
import {
  TenantDatabase as TenantDatabaseType,
  getTenantSchemaName,
} from "@wateaminbox/database";

export type TenantDatabase = TenantDatabaseType;

const DATABASE_URL = process.env.DATABASE_URL || "";

// Cache for tenant connections
const tenantConnections = new Map<string, Kysely<TenantDatabase>>();

/**
 * Get schema name for a company
 */
export function getSchemaName(companyId: string): string {
  return getTenantSchemaName(companyId);
}

/**
 * Get or create a tenant database connection
 */
export function getTenantConnection(companyId: string): Kysely<TenantDatabase> {
  const schemaName = getSchemaName(companyId);

  let connection = tenantConnections.get(companyId);
  if (connection) {
    return connection;
  }

  const pool = new PgPool({
    connectionString: DATABASE_URL,
    max: 5,
  });

  // Set search_path on all new connections from the pool
  pool.on("connect", (client) => {
    client.query(`SET search_path TO "${schemaName}"`);
  });

  const dialect = new PostgresDialect({
    pool,
  });

  connection = new Kysely<TenantDatabase>({
    dialect,
  }).withSchema(schemaName) as Kysely<TenantDatabase>;

  tenantConnections.set(companyId, connection);
  return connection;
}

/**
 * Clear a tenant connection from cache
 */
export async function clearTenantConnection(companyId: string): Promise<void> {
  const connection = tenantConnections.get(companyId);
  if (connection) {
    await connection.destroy();
    tenantConnections.delete(companyId);
  }
}

/**
 * Clear all tenant connections
 */
export async function clearAllTenantConnections(): Promise<void> {
  for (const [companyId] of tenantConnections) {
    await clearTenantConnection(companyId);
  }
}

/**
 * Check if a tenant schema exists
 */
export async function tenantSchemaExists(companyId: string): Promise<boolean> {
  const schemaName = getSchemaName(companyId);

  const dialect = new PostgresDialect({
    pool: new PgPool({
      connectionString: DATABASE_URL,
      max: 1,
    }),
  });

  const db = new Kysely<Record<string, unknown>>({ dialect });

  try {
    const result = await sql<{ exists: boolean }>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.schemata
        WHERE schema_name = ${schemaName}
      )
    `.execute(db);

    await db.destroy();
    return result.rows[0]?.exists ?? false;
  } catch {
    await db.destroy();
    return false;
  }
}

/**
 * Create a tenant schema with all required tables
 */
export async function createTenantSchema(companyId: string): Promise<void> {
  const schemaName = getSchemaName(companyId);

  const dialect = new PostgresDialect({
    pool: new PgPool({
      connectionString: DATABASE_URL,
      max: 1,
    }),
  });

  const db = new Kysely<Record<string, unknown>>({ dialect });

  try {
    // Use the setup_tenant_schema function from migrations to ensure schema consistency
    // This function creates all tables and indexes defined in the migration files
    await sql`SELECT setup_tenant_schema(${schemaName})`.execute(db);

    await db.destroy();
  } catch (error) {
    await db.destroy();
    throw error;
  }
}

/**
 * Drop a tenant schema
 */
export async function dropTenantSchema(companyId: string): Promise<void> {
  const schemaName = getSchemaName(companyId);

  // Clear cached connection first
  await clearTenantConnection(companyId);

  const dialect = new PostgresDialect({
    pool: new PgPool({
      connectionString: DATABASE_URL,
      max: 1,
    }),
  });

  const db = new Kysely<Record<string, unknown>>({ dialect });

  try {
    await sql`DROP SCHEMA IF EXISTS ${sql.ref(schemaName)} CASCADE`.execute(db);
    await db.destroy();
  } catch (error) {
    await db.destroy();
    throw error;
  }
}
