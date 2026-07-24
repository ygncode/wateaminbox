import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_sessions.processed_commands (
      connection_id UUID NOT NULL,
      command_id UUID NOT NULL,
      command_type TEXT NOT NULL,
      result JSONB NOT NULL,
      event_published BOOLEAN NOT NULL DEFAULT false,
      processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (connection_id, command_id)
    )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS whatsapp_sessions.processed_commands`.execute(
    db,
  );
}
