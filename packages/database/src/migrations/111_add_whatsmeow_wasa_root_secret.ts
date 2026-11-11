import type { Kysely } from "kysely";
import { sql } from "kysely";

/**
 * whatsmeow upstream (sqlstore upgrade v16, 2026-09) added a per-chat
 * `wasa_root_secret_id` to `whatsmeow_chat_settings` so the client can
 * remember the active WASA root secret for bot (Meta AI) chats. The Go
 * worker's PostgreSQL store (services/whatsapp/internal/store/contacts.go)
 * implements the matching `PutWASARootSecretID` / `GetWASARootSecretID`
 * methods of `store.ChatSettingsStore`, which read and write this column.
 *
 * Not a tenant table: whatsmeow state is keyed by connection and lives once in
 * `whatsapp_sessions`. `NOT NULL DEFAULT ''` matches upstream and keeps the
 * `ADD COLUMN` a catalog-only change on PostgreSQL 11+ (no table rewrite).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE whatsapp_sessions.whatsmeow_chat_settings
    ADD COLUMN IF NOT EXISTS wasa_root_secret_id TEXT NOT NULL DEFAULT ''
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE whatsapp_sessions.whatsmeow_chat_settings
    DROP COLUMN IF EXISTS wasa_root_secret_id
  `.execute(db);
}
