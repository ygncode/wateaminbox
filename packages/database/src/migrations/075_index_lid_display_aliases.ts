import type { Kysely } from "kysely";
import { sql } from "kysely";

/**
 * Support guarded historical mention resolution without scanning every stored
 * WhatsApp identity mapping for each group-detail request.
 *
 * These expressions match the display-only lookup in group.service.ts:
 * device suffixes and LID server forms are intentionally ignored because the
 * message renderer sees only the numeric token after `@`.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE INDEX IF NOT EXISTS whatsmeow_lid_mappings_normalized_jid_idx
    ON whatsapp_sessions.whatsmeow_lid_mappings ((
      split_part(split_part(jid, '@', 1), ':', 1)
      || '@' || split_part(jid, '@', 2)
    ))
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS whatsmeow_lid_mappings_mention_token_idx
    ON whatsapp_sessions.whatsmeow_lid_mappings ((
      split_part(split_part(lid, '@', 1), ':', 1)
    ))
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP INDEX IF EXISTS
      whatsapp_sessions.whatsmeow_lid_mappings_mention_token_idx
  `.execute(db);
  await sql`
    DROP INDEX IF EXISTS
      whatsapp_sessions.whatsmeow_lid_mappings_normalized_jid_idx
  `.execute(db);
}
