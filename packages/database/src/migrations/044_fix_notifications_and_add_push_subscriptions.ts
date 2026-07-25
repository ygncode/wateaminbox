import type { Kysely } from "kysely";
import { sql } from "kysely";
import { executeOnAllTenants } from "./migration-helpers.js";

/** Repair notification preferences and establish durable Web Push storage. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    const table = sql.raw(`"${schemaName}".notification_preferences`);
    await sql`ALTER TABLE ${table} ALTER COLUMN muted_contacts DROP DEFAULT`.execute(
      db,
    );
    await sql`
      ALTER TABLE ${table}
      ALTER COLUMN muted_contacts TYPE TEXT[] USING muted_contacts::text[],
      ALTER COLUMN muted_contacts SET DEFAULT ARRAY[]::TEXT[],
      ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS timezone VARCHAR(100)
    `.execute(db);

    await sql`
      CREATE TABLE IF NOT EXISTS ${sql.raw(`"${schemaName}".push_subscriptions`)} (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        user_agent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_used_at TIMESTAMPTZ
      )
    `.execute(db);
    await sql`
      CREATE INDEX IF NOT EXISTS ${sql.ref(`${schemaName}_push_subscriptions_user_idx`)}
      ON ${sql.raw(`"${schemaName}".push_subscriptions`)} (user_id)
    `.execute(db);
  });

  // setup_tenant_schema is runtime database state. Reinstall it here so a
  // company created after this migration receives the canonical tables.
  await sql`
    CREATE OR REPLACE FUNCTION setup_tenant_schema(schema_name TEXT)
    RETURNS void AS $$
    DECLARE
      safe_schema_name TEXT;
    BEGIN
      safe_schema_name := replace(schema_name, '-', '_');
      EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', schema_name);

      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.whatsapp_connections (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          name VARCHAR(100),
          phone_number VARCHAR(50),
          jid VARCHAR(100),
          status whatsapp_connection_status DEFAULT ''pending'' NOT NULL,
          connected_by UUID,
          connected_at TIMESTAMPTZ,
          last_sync_at TIMESTAMPTZ,
          sync_status VARCHAR(20),
          sync_message_count INTEGER DEFAULT 0 NOT NULL,
          sync_conversation_count INTEGER DEFAULT 0 NOT NULL,
          connection_order INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
        )
      ', schema_name);

      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.contacts (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          whatsapp_connection_id UUID,
          jid VARCHAR(100),
          phone_number VARCHAR(50),
          push_name VARCHAR(255),
          custom_name VARCHAR(255),
          notes_shared TEXT,
          is_group BOOLEAN DEFAULT false,
          profile_picture_url TEXT,
          is_online BOOLEAN DEFAULT false NOT NULL,
          last_seen TIMESTAMPTZ,
          is_blocked BOOLEAN DEFAULT false NOT NULL,
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
        )
      ', schema_name);

      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.tags (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          name VARCHAR(100) NOT NULL,
          color VARCHAR(7),
          created_by UUID,
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL
        )
      ', schema_name);

      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.contact_tags (
          contact_id UUID NOT NULL,
          tag_id UUID NOT NULL,
          PRIMARY KEY (contact_id, tag_id)
        )
      ', schema_name);

      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.contact_assignments (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          contact_id UUID NOT NULL,
          assigned_to UUID NOT NULL,
          assigned_by UUID NOT NULL,
          assigned_at TIMESTAMPTZ DEFAULT now() NOT NULL,
          unassigned_at TIMESTAMPTZ
        )
      ', schema_name);

      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.contact_notes_private (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          contact_id UUID NOT NULL,
          user_id UUID NOT NULL,
          content TEXT,
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
        )
      ', schema_name);

      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.contact_notes_shared (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          contact_id UUID NOT NULL,
          user_id UUID NOT NULL,
          author_name VARCHAR(255) NOT NULL,
          content TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
        )
      ', schema_name);

      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.messages (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          whatsapp_connection_id UUID,
          contact_id UUID,
          message_id VARCHAR(100),
          from_me BOOLEAN NOT NULL,
          sender_jid VARCHAR(100),
          message_type message_type NOT NULL,
          content TEXT,
          media_url TEXT,
          media_mime_type VARCHAR(100),
          media_size INTEGER,
          media_direct_path TEXT,
          media_key BYTEA,
          media_file_sha256 BYTEA,
          media_file_enc_sha256 BYTEA,
          media_download_status VARCHAR(20),
          media_download_error TEXT,
          media_downloaded_at TIMESTAMPTZ,
          quoted_message_id VARCHAR(100),
          is_forwarded BOOLEAN DEFAULT false,
          is_starred BOOLEAN DEFAULT false,
          deleted_by_sender BOOLEAN DEFAULT false,
          deleted_at TIMESTAMPTZ,
          sent_by_user_id UUID,
          status message_status DEFAULT ''sent'',
          metadata JSONB,
          timestamp TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
          search_vector TSVECTOR,
          CONSTRAINT %I UNIQUE (whatsapp_connection_id, message_id)
        )
      ', schema_name, safe_schema_name || '_messages_unique_wa_message');

      -- Message reactions table with UNIQUE constraint (one reaction per user per message)
      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.message_reactions (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          message_id UUID NOT NULL,
          reactor_jid VARCHAR(100) NOT NULL,
          emoji VARCHAR(10) NOT NULL,
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
          CONSTRAINT %I UNIQUE (message_id, reactor_jid)
        )
      ', schema_name, safe_schema_name || '_message_reactions_unique');

      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.groups (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          contact_id UUID,
          jid VARCHAR(100),
          name VARCHAR(255),
          description TEXT,
          created_by VARCHAR(100),
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
          participant_count INTEGER DEFAULT 0
        )
      ', schema_name);

      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.group_participants (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          group_id UUID NOT NULL,
          participant_jid VARCHAR(100) NOT NULL,
          is_admin BOOLEAN DEFAULT false,
          joined_at TIMESTAMPTZ DEFAULT now() NOT NULL
        )
      ', schema_name);

      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.status_updates (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          whatsapp_connection_id UUID,
          status_id VARCHAR(100),
          from_jid VARCHAR(100),
          media_type VARCHAR(50),
          media_url TEXT,
          caption TEXT,
          timestamp TIMESTAMPTZ NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL
        )
      ', schema_name);

      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.audit_logs (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          user_id UUID,
          action VARCHAR(100) NOT NULL,
          entity_type VARCHAR(50),
          entity_id UUID,
          details JSONB,
          ip_address INET,
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL
        )
      ', schema_name);

      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.notification_preferences (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          user_id UUID NOT NULL UNIQUE,
          sound_enabled BOOLEAN DEFAULT true,
          sound_choice VARCHAR(50) DEFAULT ''default'',
          quiet_hours_start TIME,
          quiet_hours_end TIME,
          muted_contacts TEXT[] DEFAULT ARRAY[]::TEXT[],
          notifications_enabled BOOLEAN DEFAULT true NOT NULL,
          timezone VARCHAR(100),
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
        )
      ', schema_name);

      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.notification_history (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          user_id UUID NOT NULL,
          notification_type VARCHAR(50) NOT NULL,
          title VARCHAR(255) NOT NULL,
          message TEXT,
          action_url TEXT,
          metadata JSONB,
          is_read BOOLEAN DEFAULT false,
          read_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL
        )
      ', schema_name);

      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.push_subscriptions (
          id UUID PRIMARY KEY,
          user_id UUID NOT NULL,
          endpoint TEXT NOT NULL UNIQUE,
          p256dh TEXT NOT NULL,
          auth TEXT NOT NULL,
          user_agent TEXT,
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
          last_used_at TIMESTAMPTZ
        )
      ', schema_name);

      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.quick_replies (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          shortcut VARCHAR(50) NOT NULL,
          content TEXT NOT NULL,
          created_by UUID NOT NULL,
          is_shared BOOLEAN DEFAULT false,
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
        )
      ', schema_name);

      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.conversation_states (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          contact_id UUID NOT NULL UNIQUE,
          read_by_user_id UUID,
          read_at TIMESTAMPTZ,
          last_message_at TIMESTAMPTZ,
          last_message_preview TEXT,
          unread_count INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
        )
      ', schema_name);

      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.whatsapp_labels (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          whatsapp_label_id VARCHAR(50) NOT NULL,
          name VARCHAR(100) NOT NULL,
          color VARCHAR(20),
          predefined_id INTEGER,
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
          CONSTRAINT unique_whatsapp_label UNIQUE(whatsapp_label_id)
        )
      ', schema_name);

      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.whatsapp_label_associations (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          label_id UUID NOT NULL,
          contact_id UUID,
          message_id UUID,
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
          CONSTRAINT fk_label FOREIGN KEY (label_id) REFERENCES %I.whatsapp_labels(id) ON DELETE CASCADE
        )
      ', schema_name, schema_name);

      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.whatsapp_catalogs (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          catalog_id VARCHAR(100) NOT NULL,
          name VARCHAR(255),
          description TEXT,
          product_count INTEGER DEFAULT 0,
          synced_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
          CONSTRAINT unique_catalog_id UNIQUE(catalog_id)
        )
      ', schema_name);

      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.catalog_products (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          catalog_id UUID NOT NULL,
          product_id VARCHAR(100) NOT NULL,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          price DECIMAL(12, 2),
          currency VARCHAR(3) DEFAULT ''USD'',
          image_url TEXT,
          availability VARCHAR(50) DEFAULT ''in_stock'',
          retailer_id VARCHAR(100),
          url TEXT,
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
          CONSTRAINT fk_catalog FOREIGN KEY (catalog_id) REFERENCES %I.whatsapp_catalogs(id) ON DELETE CASCADE,
          CONSTRAINT unique_product_id UNIQUE(catalog_id, product_id)
        )
      ', schema_name, schema_name);

      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.whatsmeow_lid_mappings (
          connection_id VARCHAR(100) NOT NULL,
          lid VARCHAR(100) NOT NULL,
          jid VARCHAR(100) NOT NULL,
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
          PRIMARY KEY (connection_id, lid)
        )
      ', schema_name);

      -- Create indexes
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.contacts (jid)', safe_schema_name || '_contacts_jid_idx', schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.contacts (phone_number)', safe_schema_name || '_contacts_phone_idx', schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.messages (contact_id)', safe_schema_name || '_messages_contact_idx', schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.messages (timestamp)', safe_schema_name || '_messages_timestamp_idx', schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.messages USING gin(search_vector)', safe_schema_name || '_messages_search_idx', schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.messages (message_id)', safe_schema_name || '_messages_message_id_idx', schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.push_subscriptions (user_id)', safe_schema_name || '_push_subscriptions_user_idx', schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.audit_logs (user_id)', safe_schema_name || '_audit_user_idx', schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.audit_logs (created_at)', safe_schema_name || '_audit_created_idx', schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.messages (contact_id, timestamp DESC)', safe_schema_name || '_messages_contact_timestamp_idx', schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.contact_assignments (assigned_to) WHERE unassigned_at IS NULL', safe_schema_name || '_contact_assignments_active_idx', schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.messages (contact_id, from_me) WHERE from_me = false', safe_schema_name || '_messages_incoming_idx', schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.contacts(whatsapp_connection_id)', safe_schema_name || '_contacts_wa_conn_idx', schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.messages(whatsapp_connection_id)', safe_schema_name || '_messages_wa_conn_idx', schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.messages (media_download_status, created_at) WHERE media_download_status = ''pending'' AND media_direct_path IS NOT NULL', safe_schema_name || '_idx_messages_media_pending', schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.conversation_states(contact_id)', safe_schema_name || '_conv_states_contact_idx', schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.conversation_states(last_message_at DESC)', safe_schema_name || '_conv_states_last_msg_idx', schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.whatsapp_label_associations(label_id)', safe_schema_name || '_label_assoc_label_idx', schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.whatsapp_label_associations(contact_id)', safe_schema_name || '_label_assoc_contact_idx', schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.catalog_products(catalog_id)', safe_schema_name || '_catalog_products_catalog_idx', schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.contact_notes_shared(contact_id)', safe_schema_name || '_shared_notes_contact_idx', schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.contact_notes_shared(user_id)', safe_schema_name || '_shared_notes_user_idx', schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.contact_notes_shared(contact_id, created_at DESC)', safe_schema_name || '_shared_notes_created_idx', schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.contact_notes_private(contact_id, user_id)', safe_schema_name || '_private_notes_contact_user_idx', schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.contact_notes_private(contact_id, created_at DESC)', safe_schema_name || '_private_notes_created_idx', schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.contacts (is_online, last_seen DESC NULLS LAST)', safe_schema_name || '_contacts_presence_idx', schema_name);
    END;
    $$ LANGUAGE plpgsql
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    await sql`DROP TABLE IF EXISTS ${sql.raw(`"${schemaName}".push_subscriptions`)}`.execute(
      db,
    );
    await sql`
      ALTER TABLE ${sql.raw(`"${schemaName}".notification_preferences`)}
      DROP COLUMN IF EXISTS notifications_enabled,
      DROP COLUMN IF EXISTS timezone
    `.execute(db);
  });
  // Keep muted_contacts as TEXT[]: converting JIDs back to UUID[] is lossy.
}
