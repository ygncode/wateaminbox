import { type Kysely, sql } from "kysely";
import { executeOnAllTenants } from "./migration-helpers.js";

/**
 * Store outbound messages scheduled for future delivery. A poller claims due
 * rows and hands them to the regular send pipeline; next_attempt_at drives
 * both the initial dispatch and retry backoff.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    const table = sql.table(`${schemaName}.scheduled_messages`);
    await sql`
      CREATE TABLE IF NOT EXISTS ${table} (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contact_id UUID NOT NULL,
        content TEXT NOT NULL,
        message_type message_type NOT NULL DEFAULT 'text',
        reply_to_message_id UUID,
        scheduled_at TIMESTAMPTZ NOT NULL,
        status TEXT NOT NULL DEFAULT 'scheduled'
          CHECK (status IN ('scheduled', 'processing', 'sent', 'failed', 'canceled')),
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMPTZ NOT NULL,
        last_error TEXT,
        sent_message_id UUID,
        created_by UUID NOT NULL,
        canceled_by UUID,
        canceled_at TIMESTAMPTZ,
        sent_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `.execute(db);
    await sql`
      CREATE INDEX IF NOT EXISTS ${sql.ref(
        `${schemaName}_scheduled_messages_due_idx`,
      )}
      ON ${table} (next_attempt_at)
      WHERE status IN ('scheduled', 'processing')
    `.execute(db);
    await sql`
      CREATE INDEX IF NOT EXISTS ${sql.ref(
        `${schemaName}_scheduled_messages_contact_idx`,
      )}
      ON ${table} (contact_id, scheduled_at)
    `.execute(db);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    const table = sql.table(`${schemaName}.scheduled_messages`);
    await sql`DROP TABLE IF EXISTS ${table}`.execute(db);
  });
}
