import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_sessions.worker_event_outbox (
      connection_id UUID NOT NULL,
      event_id UUID NOT NULL,
      subject TEXT NOT NULL,
      payload BYTEA NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (connection_id, event_id)
    )
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS worker_event_outbox_pending_idx
    ON whatsapp_sessions.worker_event_outbox (connection_id, created_at)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP TABLE IF EXISTS whatsapp_sessions.worker_event_outbox
  `.execute(db);
}
