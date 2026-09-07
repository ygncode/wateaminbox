import { type Kysely, sql } from "kysely";
import { installOutboxRecipientIndex } from "../dispatch-schema.js";
import { getTenantSchemas } from "./migration-helpers.js";

// History outbox entries live until API application, not merely broker delivery.
export async function up(db: Kysely<unknown>): Promise<void> {
  for (const schema of await getTenantSchemas(db))
    await installOutboxRecipientIndex(db, schema);
  await sql`ALTER TABLE whatsapp_sessions.worker_event_outbox
    ADD COLUMN event_order BIGSERIAL,
    ADD COLUMN published_at TIMESTAMPTZ`.execute(db);
  await sql`CREATE INDEX worker_event_outbox_apply_idx
    ON whatsapp_sessions.worker_event_outbox (connection_id, event_order)`.execute(
    db,
  );
  await sql`CREATE INDEX worker_event_outbox_unpublished_idx
    ON whatsapp_sessions.worker_event_outbox (connection_id, created_at, event_id)
    WHERE published_at IS NULL`.execute(db);
  await sql`CREATE INDEX worker_event_outbox_markers_idx
    ON whatsapp_sessions.worker_event_outbox (event_order)
    WHERE published_at IS NOT NULL
      AND split_part(subject, '.', 5) IN ('sync_status', 'history_sync_page')`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const schema of await getTenantSchemas(db))
    await sql`DROP INDEX IF EXISTS ${sql.id(schema, `${schema}_outbox_to_idx`)}`.execute(
      db,
    );
  await sql`ALTER TABLE whatsapp_sessions.worker_event_outbox
    DROP COLUMN published_at, DROP COLUMN event_order`.execute(db);
}
