import { type Kysely, sql } from "kysely";
import { executeOnAllTenants } from "./migration-helpers.js";

/**
 * Bulk broadcast jobs: a tenant-scoped parent table whose recipients are
 * materialized as one scheduled_messages leaf each at creation time. Leaves
 * gain bulk_job_id (parent link) and skip_reason (why an ineligible recipient
 * was snapshotted as "skipped" — a new terminal status added to the CHECK).
 *
 * bulk_connection_budgets is the global per-connection pacing/quota ledger:
 * the dispatcher locks a connection's row FOR UPDATE before claiming a bulk
 * leaf, so overlapping jobs and concurrent replicas share one send budget.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    const bulkJobs = sql.table(`${schemaName}.bulk_jobs`);
    await sql`
      CREATE TABLE IF NOT EXISTS ${bulkJobs} (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'scheduled'
          CHECK (status IN ('scheduled', 'running', 'completed', 'completed_with_errors', 'canceled')),
        content TEXT NOT NULL,
        message_type message_type NOT NULL DEFAULT 'text',
        media_url TEXT,
        media_mime_type TEXT,
        media_file_name TEXT,
        audience JSONB NOT NULL,
        audience_hash TEXT NOT NULL,
        scheduled_at TIMESTAMPTZ NOT NULL,
        total_recipients INTEGER NOT NULL DEFAULT 0,
        skipped_recipients INTEGER NOT NULL DEFAULT 0,
        idempotency_key TEXT,
        created_by UUID NOT NULL,
        canceled_by UUID,
        canceled_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `.execute(db);
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS ${sql.ref(
        `${schemaName}_bulk_jobs_idempotency_uidx`,
      )}
      ON ${bulkJobs} (idempotency_key)
      WHERE idempotency_key IS NOT NULL
    `.execute(db);
    await sql`
      CREATE INDEX IF NOT EXISTS ${sql.ref(`${schemaName}_bulk_jobs_status_idx`)}
      ON ${bulkJobs} (status, scheduled_at)
    `.execute(db);

    await sql`
      CREATE TABLE IF NOT EXISTS ${sql.table(
        `${schemaName}.bulk_connection_budgets`,
      )} (
        whatsapp_connection_id UUID PRIMARY KEY,
        next_eligible_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        quota_date DATE NOT NULL DEFAULT CURRENT_DATE,
        sent_today INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `.execute(db);

    const scheduled = sql.table(`${schemaName}.scheduled_messages`);
    await sql`
      ALTER TABLE ${scheduled}
      ADD COLUMN IF NOT EXISTS bulk_job_id UUID,
      ADD COLUMN IF NOT EXISTS skip_reason TEXT
    `.execute(db);
    await sql`
      ALTER TABLE ${scheduled}
      DROP CONSTRAINT IF EXISTS scheduled_messages_status_check
    `.execute(db);
    await sql`
      ALTER TABLE ${scheduled}
      ADD CONSTRAINT scheduled_messages_status_check
      CHECK (status IN ('scheduled', 'processing', 'sent', 'failed', 'canceled', 'skipped'))
    `.execute(db);
    await sql`
      CREATE INDEX IF NOT EXISTS ${sql.ref(
        `${schemaName}_scheduled_messages_bulk_job_idx`,
      )}
      ON ${scheduled} (bulk_job_id, status)
      WHERE bulk_job_id IS NOT NULL
    `.execute(db);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    const scheduled = sql.table(`${schemaName}.scheduled_messages`);
    await sql`
      DROP INDEX IF EXISTS ${sql.ref(
        `${schemaName}.${schemaName}_scheduled_messages_bulk_job_idx`,
      )}
    `.execute(db);
    await sql`
      ALTER TABLE ${scheduled}
      DROP CONSTRAINT IF EXISTS scheduled_messages_status_check
    `.execute(db);
    await sql`
      ALTER TABLE ${scheduled}
      ADD CONSTRAINT scheduled_messages_status_check
      CHECK (status IN ('scheduled', 'processing', 'sent', 'failed', 'canceled'))
    `.execute(db);
    await sql`
      ALTER TABLE ${scheduled}
      DROP COLUMN IF EXISTS bulk_job_id,
      DROP COLUMN IF EXISTS skip_reason
    `.execute(db);
    await sql`
      DROP TABLE IF EXISTS ${sql.table(`${schemaName}.bulk_connection_budgets`)}
    `.execute(db);
    await sql`
      DROP TABLE IF EXISTS ${sql.table(`${schemaName}.bulk_jobs`)}
    `.execute(db);
  });
}
