import type { Kysely } from "kysely";
import { sql } from "kysely";

/**
 * Persist the complete whatsmeow device identity and normalize LID mappings.
 *
 * Device LIDs and Signal sessions must survive worker restarts. Without them,
 * direct messages can be acknowledged by WhatsApp while the sender's primary
 * device only displays "Waiting for this message".
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE whatsapp_sessions.whatsmeow_device
      ADD COLUMN IF NOT EXISTS lid TEXT,
      ADD COLUMN IF NOT EXISTS adv_account_sig_key BYTEA,
      ADD COLUMN IF NOT EXISTS lid_migration_ts BIGINT NOT NULL DEFAULT 0
  `.execute(db);

  // LID mappings are identities, not device-specific addresses. Normalize old
  // rows while retaining the newest mapping for each connection and LID.
  await sql`
    WITH removed AS (
      DELETE FROM whatsapp_sessions.whatsmeow_lid_mappings
      RETURNING connection_id, lid, jid, created_at
    ),
    normalized AS (
      SELECT DISTINCT ON (
        connection_id,
        regexp_replace(lid, ':[0-9]+@', '@')
      )
        connection_id,
        regexp_replace(lid, ':[0-9]+@', '@') AS lid,
        regexp_replace(jid, ':[0-9]+@', '@') AS jid,
        created_at
      FROM removed
      ORDER BY
        connection_id,
        regexp_replace(lid, ':[0-9]+@', '@'),
        created_at DESC
    )
    INSERT INTO whatsapp_sessions.whatsmeow_lid_mappings (
      connection_id,
      lid,
      jid,
      created_at
    )
    SELECT connection_id, lid, jid, created_at
    FROM normalized
  `.execute(db);

  // Recover each existing device's LID from the mapping cache. New pairings
  // persist it directly through the device store.
  await sql`
    UPDATE whatsapp_sessions.whatsmeow_device AS device
    SET lid = CASE
      WHEN device.jid ~ ':[0-9]+@' THEN regexp_replace(
        mapping.lid,
        '@',
        substring(device.jid from '(:[0-9]+)@') || '@'
      )
      ELSE mapping.lid
    END
    FROM whatsapp_sessions.whatsmeow_lid_mappings AS mapping
    WHERE mapping.connection_id::text = device.connection_id::text
      AND mapping.jid = regexp_replace(device.jid, ':[0-9]+@', '@')
      AND device.lid IS NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE whatsapp_sessions.whatsmeow_device
      DROP COLUMN IF EXISTS lid,
      DROP COLUMN IF EXISTS adv_account_sig_key,
      DROP COLUMN IF EXISTS lid_migration_ts
  `.execute(db);
}
