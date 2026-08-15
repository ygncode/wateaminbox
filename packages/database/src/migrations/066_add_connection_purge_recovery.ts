import type { Kysely } from "kysely";
import { sql } from "kysely";
import { executeOnAllTenants } from "./migration-helpers.js";

async function constraintExists(
  db: Kysely<unknown>,
  schemaName: string,
  tableName: string,
  constraintName: string,
): Promise<boolean> {
  const result = await sql<{ exists: boolean }>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_constraint AS constraint_record
      JOIN pg_class AS table_record
        ON table_record.oid = constraint_record.conrelid
      JOIN pg_namespace AS schema_record
        ON schema_record.oid = table_record.relnamespace
      WHERE schema_record.nspname = ${schemaName}
        AND table_record.relname = ${tableName}
        AND constraint_record.conname = ${constraintName}
    ) AS exists
  `.execute(db);
  return result.rows[0]?.exists ?? false;
}

/**
 * Apply this migration to ONE tenant schema.
 *
 * Exported so CI can exercise the real DDL against purpose-built schemas:
 * `up` fans this out with `executeOnAllTenants`, which walks every
 * `tenant_%` schema in the database and therefore cannot run hermetically
 * inside a shared test database.
 */
export async function applyConnectionPurgeRecovery(
  db: Kysely<unknown>,
  schemaName: string,
): Promise<void> {
  {
    const bulkJobs = sql.table(`${schemaName}.bulk_jobs`);
    await sql`
      ALTER TABLE ${bulkJobs}
      ADD COLUMN IF NOT EXISTS purged_sent INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS purged_failed INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS purged_canceled INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS purged_skipped INTEGER NOT NULL DEFAULT 0
    `.execute(db);

    const cleanupItems = sql.table(`${schemaName}.purge_cleanup_items`);
    await sql`
      CREATE TABLE IF NOT EXISTS ${cleanupItems} (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        connection_id UUID NOT NULL,
        kind TEXT NOT NULL
          CHECK (kind IN ('search_contact', 'media', 'bulk_job')),
        reference TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (connection_id, kind, reference)
      )
    `.execute(db);
    await sql`
      CREATE INDEX IF NOT EXISTS ${sql.ref(`${schemaName}_pci_due_idx`)}
      ON ${cleanupItems} (next_attempt_at, created_at)
    `.execute(db);

    // NOT VALID tolerates historical orphans while enforcing and locking every
    // new connection-owned insert immediately.
    for (const relation of [
      ["contacts", "contacts_connection_fk"],
      ["messages", "messages_connection_fk"],
      ["status_updates", "status_updates_connection_fk"],
      ["bulk_connection_budgets", "bulk_connection_budgets_connection_fk"],
    ] as const) {
      if (await constraintExists(db, schemaName, relation[0], relation[1])) {
        continue;
      }
      await sql`
        ALTER TABLE ${sql.table(`${schemaName}.${relation[0]}`)}
        ADD CONSTRAINT ${sql.ref(relation[1])}
        FOREIGN KEY (whatsapp_connection_id)
        REFERENCES ${sql.table(`${schemaName}.whatsapp_connections`)}(id)
        ON DELETE CASCADE NOT VALID
      `.execute(db);
    }
  }
}

/**
 * Preserve bulk-job outcome counters when recipient leaves are erased, and
 * retain durable external cleanup work after a permanent connection purge.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, (schemaName) =>
    applyConnectionPurgeRecovery(db, schemaName),
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    for (const relation of [
      ["contacts", "contacts_connection_fk"],
      ["messages", "messages_connection_fk"],
      ["status_updates", "status_updates_connection_fk"],
      ["bulk_connection_budgets", "bulk_connection_budgets_connection_fk"],
    ] as const) {
      await sql`
        ALTER TABLE ${sql.table(`${schemaName}.${relation[0]}`)}
        DROP CONSTRAINT IF EXISTS ${sql.ref(relation[1])}
      `.execute(db);
    }
    await sql`
      DROP TABLE IF EXISTS ${sql.table(`${schemaName}.purge_cleanup_items`)}
    `.execute(db);
    await sql`
      ALTER TABLE ${sql.table(`${schemaName}.bulk_jobs`)}
      DROP COLUMN IF EXISTS purged_sent,
      DROP COLUMN IF EXISTS purged_failed,
      DROP COLUMN IF EXISTS purged_canceled,
      DROP COLUMN IF EXISTS purged_skipped
    `.execute(db);
  });
}
