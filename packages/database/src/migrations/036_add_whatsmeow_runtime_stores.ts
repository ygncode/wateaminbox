import type { Kysely } from "kysely";
import { sql } from "kysely";

/**
 * Add stores required by current whatsmeow releases.
 *
 * Missing NCTSalt/EventBuffer stores leave nil interfaces on store.Device. A
 * direct-message send then panics while deriving the cstoken, terminating the
 * worker instead of returning a send result.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_sessions.whatsmeow_nct_salt (
      connection_id UUID NOT NULL,
      our_jid TEXT NOT NULL,
      salt BYTEA NOT NULL,
      PRIMARY KEY (connection_id, our_jid)
    )
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_sessions.whatsmeow_event_buffer (
      connection_id UUID NOT NULL,
      our_jid TEXT NOT NULL,
      ciphertext_hash BYTEA NOT NULL CHECK (octet_length(ciphertext_hash) = 32),
      plaintext BYTEA,
      server_timestamp BIGINT NOT NULL,
      insert_timestamp BIGINT NOT NULL,
      PRIMARY KEY (connection_id, our_jid, ciphertext_hash)
    )
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_whatsmeow_event_buffer_timestamp
    ON whatsapp_sessions.whatsmeow_event_buffer (
      connection_id,
      our_jid,
      insert_timestamp
    )
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_sessions.whatsmeow_retry_buffer (
      connection_id UUID NOT NULL,
      our_jid TEXT NOT NULL,
      chat_jid TEXT NOT NULL,
      message_id TEXT NOT NULL,
      format TEXT NOT NULL,
      plaintext BYTEA NOT NULL,
      timestamp BIGINT NOT NULL,
      PRIMARY KEY (connection_id, our_jid, chat_jid, message_id)
    )
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_whatsmeow_retry_buffer_timestamp
    ON whatsapp_sessions.whatsmeow_retry_buffer (
      connection_id,
      our_jid,
      timestamp
    )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS whatsapp_sessions.whatsmeow_retry_buffer`.execute(
    db,
  );
  await sql`DROP TABLE IF EXISTS whatsapp_sessions.whatsmeow_event_buffer`.execute(
    db,
  );
  await sql`DROP TABLE IF EXISTS whatsapp_sessions.whatsmeow_nct_salt`.execute(
    db,
  );
}
