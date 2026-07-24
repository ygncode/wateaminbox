import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool as PgPool } from "pg";
import {
  type TenantDatabase as TenantDatabaseType,
  getTenantSchemaName,
} from "@wateaminbox/database";
import { env } from "../lib/env.js";

export type TenantDatabase = TenantDatabaseType;

// Tenant handles share one bounded pool. withSchema() qualifies every table
// reference, so connections never rely on mutable per-connection search_path.
const tenantPool = new PgPool({
  connectionString: env.DATABASE_URL,
  max: env.TENANT_DB_POOL_MAX,
});
const baseTenantDb = new Kysely<TenantDatabase>({
  dialect: new PostgresDialect({ pool: tenantPool }),
});

// These are lightweight schema-scoped query builders, not independent pools.
const tenantConnections = new Map<string, Kysely<TenantDatabase>>();

export function getSchemaName(companyId: string): string {
  return getTenantSchemaName(companyId);
}

export function getTenantConnection(companyId: string): Kysely<TenantDatabase> {
  const existing = tenantConnections.get(companyId);
  if (existing) return existing;

  const connection = baseTenantDb.withSchema(
    getSchemaName(companyId),
  ) as Kysely<TenantDatabase>;
  tenantConnections.set(companyId, connection);
  return connection;
}

export async function clearTenantConnection(companyId: string): Promise<void> {
  // Do not destroy schema-scoped handles: they share the process-wide pool.
  tenantConnections.delete(companyId);
}

export async function clearAllTenantConnections(): Promise<void> {
  tenantConnections.clear();
}

export async function shutdownTenantConnections(): Promise<void> {
  tenantConnections.clear();
  await baseTenantDb.destroy();
}

export async function tenantSchemaExists(companyId: string): Promise<boolean> {
  const schemaName = getSchemaName(companyId);
  const result = await sql<{ exists: boolean }>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.schemata
      WHERE schema_name = ${schemaName}
    )
  `.execute(baseTenantDb);

  return result.rows[0]?.exists ?? false;
}

export async function createTenantSchema(companyId: string): Promise<void> {
  const schemaName = getSchemaName(companyId);
  await sql`SELECT setup_tenant_schema(${schemaName})`.execute(baseTenantDb);
}

export async function dropTenantSchema(companyId: string): Promise<void> {
  const schemaName = getSchemaName(companyId);
  await clearTenantConnection(companyId);
  await sql`DROP SCHEMA IF EXISTS ${sql.ref(schemaName)} CASCADE`.execute(
    baseTenantDb,
  );
}
