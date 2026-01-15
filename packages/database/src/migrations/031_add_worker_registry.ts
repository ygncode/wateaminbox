import { sql, type Kysely } from 'kysely'

/**
 * Migration 031: Add worker_registry table for orchestrator persistence
 *
 * This migration creates a table in the public schema to persist worker state.
 * When the orchestrator restarts, it can recover running workers from this table
 * instead of orphaning them.
 *
 * The table tracks:
 * - Worker process PIDs
 * - Connection and company associations
 * - Restart attempts for auto-recovery
 * - Heartbeat timestamps for health monitoring
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  console.log('Migration 031: Creating worker_registry table...')

  await db.schema
    .createTable('worker_registry')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('connection_id', 'uuid', (col) => col.notNull())
    .addColumn('company_id', 'uuid', (col) => col.notNull())
    .addColumn('tenant_schema', 'varchar(100)', (col) => col.notNull())
    .addColumn('pid', 'integer', (col) => col.notNull())
    .addColumn('status', 'varchar(20)', (col) =>
      col.notNull().defaultTo('starting')
    )
    .addColumn('started_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .addColumn('last_heartbeat', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .addColumn('restart_count', 'integer', (col) =>
      col.notNull().defaultTo(0)
    )
    .addColumn('database_url', 'text', (col) => col.notNull())
    .execute()

  // Unique constraint on connection_id - only one worker per connection
  await db.schema
    .createIndex('idx_worker_registry_connection')
    .on('worker_registry')
    .column('connection_id')
    .unique()
    .execute()

  // Index for looking up workers by company
  await db.schema
    .createIndex('idx_worker_registry_company')
    .on('worker_registry')
    .column('company_id')
    .execute()

  console.log('Migration 031: Completed creating worker_registry table')
}

export async function down(db: Kysely<unknown>): Promise<void> {
  console.log('Migration 031: Dropping worker_registry table...')

  await db.schema.dropIndex('idx_worker_registry_company').execute()
  await db.schema.dropIndex('idx_worker_registry_connection').execute()
  await db.schema.dropTable('worker_registry').execute()

  console.log('Migration 031: Completed dropping worker_registry table')
}
