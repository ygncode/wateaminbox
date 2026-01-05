import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * Migration 016: Ensure whatsapp_sessions schema and whatsmeow tables exist
 *
 * Some environments are missing the whatsapp_sessions.whatsmeow_* tables, causing
 * the WhatsApp worker to fail at startup. This migration idempotently recreates the
 * whatsapp_sessions schema and all required whatsmeow tables/indexes if they are missing.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // Ensure schema exists
  await sql`CREATE SCHEMA IF NOT EXISTS whatsapp_sessions`.execute(db)

  // Core whatsmeow tables
  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_sessions.whatsmeow_device (
      connection_id UUID NOT NULL,
      jid TEXT NOT NULL,
      registration_id BIGINT NOT NULL,
      noise_key BYTEA NOT NULL,
      identity_key BYTEA NOT NULL,
      signed_pre_key BYTEA NOT NULL,
      signed_pre_key_id INTEGER NOT NULL,
      signed_pre_key_sig BYTEA NOT NULL,
      adv_key BYTEA NOT NULL,
      adv_details BYTEA NOT NULL,
      adv_account_sig BYTEA NOT NULL,
      adv_device_sig BYTEA NOT NULL,
      platform TEXT NOT NULL DEFAULT '',
      business_name TEXT NOT NULL DEFAULT '',
      push_name TEXT NOT NULL DEFAULT '',
      facebook_uuid UUID,
      PRIMARY KEY (connection_id, jid)
    )
  `.execute(db)

  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_sessions.whatsmeow_identity_keys (
      connection_id UUID NOT NULL,
      our_jid TEXT NOT NULL,
      their_id TEXT NOT NULL,
      identity BYTEA NOT NULL,
      PRIMARY KEY (connection_id, our_jid, their_id)
    )
  `.execute(db)

  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_sessions.whatsmeow_sessions (
      connection_id UUID NOT NULL,
      our_jid TEXT NOT NULL,
      their_id TEXT NOT NULL,
      session BYTEA NOT NULL,
      PRIMARY KEY (connection_id, our_jid, their_id)
    )
  `.execute(db)

  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_sessions.whatsmeow_pre_keys (
      connection_id UUID NOT NULL,
      jid TEXT NOT NULL,
      key_id INTEGER NOT NULL,
      key BYTEA NOT NULL,
      uploaded BOOLEAN NOT NULL DEFAULT false,
      PRIMARY KEY (connection_id, jid, key_id)
    )
  `.execute(db)

  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_sessions.whatsmeow_sender_keys (
      connection_id UUID NOT NULL,
      our_jid TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      sender_key BYTEA NOT NULL,
      PRIMARY KEY (connection_id, our_jid, chat_id, sender_id)
    )
  `.execute(db)

  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_sessions.whatsmeow_app_state_sync_keys (
      connection_id UUID NOT NULL,
      jid TEXT NOT NULL,
      key_id BYTEA NOT NULL,
      key_data BYTEA NOT NULL,
      timestamp BIGINT NOT NULL,
      fingerprint BYTEA NOT NULL,
      PRIMARY KEY (connection_id, jid, key_id)
    )
  `.execute(db)

  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_sessions.whatsmeow_app_state_version (
      connection_id UUID NOT NULL,
      jid TEXT NOT NULL,
      name TEXT NOT NULL,
      version BIGINT NOT NULL,
      hash BYTEA NOT NULL,
      PRIMARY KEY (connection_id, jid, name)
    )
  `.execute(db)

  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_sessions.whatsmeow_app_state_mutation_macs (
      connection_id UUID NOT NULL,
      jid TEXT NOT NULL,
      name TEXT NOT NULL,
      version BIGINT NOT NULL,
      index_mac BYTEA NOT NULL,
      value_mac BYTEA NOT NULL,
      PRIMARY KEY (connection_id, jid, name, version, index_mac)
    )
  `.execute(db)

  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_sessions.whatsmeow_contacts (
      connection_id UUID NOT NULL,
      our_jid TEXT NOT NULL,
      their_jid TEXT NOT NULL,
      first_name TEXT,
      full_name TEXT,
      push_name TEXT,
      business_name TEXT,
      PRIMARY KEY (connection_id, our_jid, their_jid)
    )
  `.execute(db)

  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_sessions.whatsmeow_chat_settings (
      connection_id UUID NOT NULL,
      our_jid TEXT NOT NULL,
      chat_jid TEXT NOT NULL,
      muted_until BIGINT NOT NULL DEFAULT 0,
      pinned BOOLEAN NOT NULL DEFAULT false,
      archived BOOLEAN NOT NULL DEFAULT false,
      PRIMARY KEY (connection_id, our_jid, chat_jid)
    )
  `.execute(db)

  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_sessions.whatsmeow_version (
      connection_id UUID NOT NULL PRIMARY KEY,
      version INTEGER NOT NULL
    )
  `.execute(db)

  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_sessions.whatsmeow_lid_mappings (
      connection_id VARCHAR(100) NOT NULL,
      lid VARCHAR(100) NOT NULL,
      jid VARCHAR(100) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
      PRIMARY KEY (connection_id, lid)
    )
  `.execute(db)

  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_sessions.whatsmeow_privacy_tokens (
      connection_id UUID NOT NULL,
      our_jid TEXT NOT NULL,
      user_jid TEXT NOT NULL,
      token BYTEA NOT NULL,
      timestamp BIGINT NOT NULL,
      PRIMARY KEY (connection_id, our_jid, user_jid)
    )
  `.execute(db)

  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_sessions.whatsmeow_message_secrets (
      connection_id UUID NOT NULL,
      our_jid TEXT NOT NULL,
      chat_jid TEXT NOT NULL,
      sender_jid TEXT NOT NULL,
      message_id TEXT NOT NULL,
      secret BYTEA NOT NULL,
      PRIMARY KEY (connection_id, our_jid, chat_jid, sender_jid, message_id)
    )
  `.execute(db)

  // Indexes for performance
  await sql`CREATE INDEX IF NOT EXISTS idx_whatsmeow_device_connection ON whatsapp_sessions.whatsmeow_device(connection_id)`.execute(
    db
  )
  await sql`CREATE INDEX IF NOT EXISTS idx_whatsmeow_sessions_connection ON whatsapp_sessions.whatsmeow_sessions(connection_id)`.execute(
    db
  )
  await sql`CREATE INDEX IF NOT EXISTS idx_whatsmeow_identity_keys_connection ON whatsapp_sessions.whatsmeow_identity_keys(connection_id)`.execute(
    db
  )
  await sql`CREATE INDEX IF NOT EXISTS idx_whatsmeow_pre_keys_connection ON whatsapp_sessions.whatsmeow_pre_keys(connection_id)`.execute(
    db
  )
  await sql`CREATE INDEX IF NOT EXISTS idx_whatsmeow_sender_keys_connection ON whatsapp_sessions.whatsmeow_sender_keys(connection_id)`.execute(
    db
  )
  await sql`CREATE INDEX IF NOT EXISTS idx_whatsmeow_contacts_connection ON whatsapp_sessions.whatsmeow_contacts(connection_id)`.execute(
    db
  )
  await sql`CREATE INDEX IF NOT EXISTS idx_whatsmeow_privacy_tokens_connection ON whatsapp_sessions.whatsmeow_privacy_tokens(connection_id)`.execute(
    db
  )
  await sql`CREATE INDEX IF NOT EXISTS idx_whatsmeow_message_secrets_connection ON whatsapp_sessions.whatsmeow_message_secrets(connection_id)`.execute(
    db
  )
}

export async function down(): Promise<void> {
  // Not reversible safely; leave schema in place for existing devices
  console.log('Migration 016 is non-reversible to avoid data loss')
}
