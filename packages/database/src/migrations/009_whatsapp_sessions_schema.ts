import { Kysely, sql } from 'kysely'

/**
 * This migration:
 * 1. Creates the whatsapp_sessions schema for storing whatsmeow session data
 * 2. Adds max_whatsapp_connections column to companies table
 * 3. Updates tenant schema template to add name/connection_order to whatsapp_connections
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // Create whatsapp_sessions schema
  await sql`CREATE SCHEMA IF NOT EXISTS whatsapp_sessions`.execute(db)

  // Device store - core whatsmeow table for device credentials
  await sql`
    CREATE TABLE whatsapp_sessions.whatsmeow_device (
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

  // Identity keys - Signal protocol identity keys
  await sql`
    CREATE TABLE whatsapp_sessions.whatsmeow_identity_keys (
      connection_id UUID NOT NULL,
      our_jid TEXT NOT NULL,
      their_id TEXT NOT NULL,
      identity BYTEA NOT NULL,
      PRIMARY KEY (connection_id, our_jid, their_id)
    )
  `.execute(db)

  // Sessions - Signal protocol session state
  await sql`
    CREATE TABLE whatsapp_sessions.whatsmeow_sessions (
      connection_id UUID NOT NULL,
      our_jid TEXT NOT NULL,
      their_id TEXT NOT NULL,
      session BYTEA NOT NULL,
      PRIMARY KEY (connection_id, our_jid, their_id)
    )
  `.execute(db)

  // Pre-keys - Signal protocol pre-shared keys
  await sql`
    CREATE TABLE whatsapp_sessions.whatsmeow_pre_keys (
      connection_id UUID NOT NULL,
      jid TEXT NOT NULL,
      key_id INTEGER NOT NULL,
      key BYTEA NOT NULL,
      uploaded BOOLEAN NOT NULL DEFAULT false,
      PRIMARY KEY (connection_id, jid, key_id)
    )
  `.execute(db)

  // Sender keys - Group encryption keys
  await sql`
    CREATE TABLE whatsapp_sessions.whatsmeow_sender_keys (
      connection_id UUID NOT NULL,
      our_jid TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      sender_key BYTEA NOT NULL,
      PRIMARY KEY (connection_id, our_jid, chat_id, sender_id)
    )
  `.execute(db)

  // App state sync keys
  await sql`
    CREATE TABLE whatsapp_sessions.whatsmeow_app_state_sync_keys (
      connection_id UUID NOT NULL,
      jid TEXT NOT NULL,
      key_id BYTEA NOT NULL,
      key_data BYTEA NOT NULL,
      timestamp BIGINT NOT NULL,
      fingerprint BYTEA NOT NULL,
      PRIMARY KEY (connection_id, jid, key_id)
    )
  `.execute(db)

  // App state version
  await sql`
    CREATE TABLE whatsapp_sessions.whatsmeow_app_state_version (
      connection_id UUID NOT NULL,
      jid TEXT NOT NULL,
      name TEXT NOT NULL,
      version BIGINT NOT NULL,
      hash BYTEA NOT NULL,
      PRIMARY KEY (connection_id, jid, name)
    )
  `.execute(db)

  // App state mutation MACs
  await sql`
    CREATE TABLE whatsapp_sessions.whatsmeow_app_state_mutation_macs (
      connection_id UUID NOT NULL,
      jid TEXT NOT NULL,
      name TEXT NOT NULL,
      version BIGINT NOT NULL,
      index_mac BYTEA NOT NULL,
      value_mac BYTEA NOT NULL,
      PRIMARY KEY (connection_id, jid, name, version, index_mac)
    )
  `.execute(db)

  // Contacts cache
  await sql`
    CREATE TABLE whatsapp_sessions.whatsmeow_contacts (
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

  // Chat settings
  await sql`
    CREATE TABLE whatsapp_sessions.whatsmeow_chat_settings (
      connection_id UUID NOT NULL,
      our_jid TEXT NOT NULL,
      chat_jid TEXT NOT NULL,
      muted_until BIGINT NOT NULL DEFAULT 0,
      pinned BOOLEAN NOT NULL DEFAULT false,
      archived BOOLEAN NOT NULL DEFAULT false,
      PRIMARY KEY (connection_id, our_jid, chat_jid)
    )
  `.execute(db)

  // Schema version tracking per connection
  await sql`
    CREATE TABLE whatsapp_sessions.whatsmeow_version (
      connection_id UUID NOT NULL PRIMARY KEY,
      version INTEGER NOT NULL
    )
  `.execute(db)

  // Create indexes for performance
  await sql`CREATE INDEX idx_whatsmeow_device_connection ON whatsapp_sessions.whatsmeow_device(connection_id)`.execute(db)
  await sql`CREATE INDEX idx_whatsmeow_sessions_connection ON whatsapp_sessions.whatsmeow_sessions(connection_id)`.execute(db)
  await sql`CREATE INDEX idx_whatsmeow_identity_keys_connection ON whatsapp_sessions.whatsmeow_identity_keys(connection_id)`.execute(db)
  await sql`CREATE INDEX idx_whatsmeow_pre_keys_connection ON whatsapp_sessions.whatsmeow_pre_keys(connection_id)`.execute(db)
  await sql`CREATE INDEX idx_whatsmeow_sender_keys_connection ON whatsapp_sessions.whatsmeow_sender_keys(connection_id)`.execute(db)
  await sql`CREATE INDEX idx_whatsmeow_contacts_connection ON whatsapp_sessions.whatsmeow_contacts(connection_id)`.execute(db)

  // Add max_whatsapp_connections to companies table
  await sql`
    ALTER TABLE public.companies
    ADD COLUMN IF NOT EXISTS max_whatsapp_connections INTEGER NOT NULL DEFAULT 5
  `.execute(db)

  // Update the setup_tenant_schema function to add new columns to whatsapp_connections
  await sql`
    CREATE OR REPLACE FUNCTION setup_tenant_schema(schema_name TEXT)
    RETURNS void AS $$
    BEGIN
      -- Create the schema
      EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', schema_name);

      -- WhatsApp connections table (updated with name and connection_order)
      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.whatsapp_connections (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          name VARCHAR(100),
          phone_number VARCHAR(20),
          jid VARCHAR(100),
          status whatsapp_connection_status DEFAULT ''pending'' NOT NULL,
          connected_by UUID,
          connected_at TIMESTAMPTZ,
          last_sync_at TIMESTAMPTZ,
          connection_order INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
        )
      ', schema_name);

      -- Contacts table
      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.contacts (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          whatsapp_connection_id UUID,
          jid VARCHAR(100),
          phone_number VARCHAR(20),
          push_name VARCHAR(255),
          custom_name VARCHAR(255),
          notes_shared TEXT,
          is_group BOOLEAN DEFAULT false,
          profile_picture_url TEXT,
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
        )
      ', schema_name);

      -- Tags table
      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.tags (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          name VARCHAR(100) NOT NULL,
          color VARCHAR(7),
          created_by UUID,
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL
        )
      ', schema_name);

      -- Contact tags junction table
      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.contact_tags (
          contact_id UUID NOT NULL,
          tag_id UUID NOT NULL,
          PRIMARY KEY (contact_id, tag_id)
        )
      ', schema_name);

      -- Contact assignments table
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

      -- Private contact notes table
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

      -- Messages table (with status column for delivery receipts)
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
          quoted_message_id VARCHAR(100),
          is_forwarded BOOLEAN DEFAULT false,
          is_starred BOOLEAN DEFAULT false,
          deleted_by_sender BOOLEAN DEFAULT false,
          deleted_at TIMESTAMPTZ,
          sent_by_user_id UUID,
          status message_status DEFAULT ''sent'',
          timestamp TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
          search_vector TSVECTOR
        )
      ', schema_name);

      -- Message reactions table
      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.message_reactions (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          message_id UUID NOT NULL,
          reactor_jid VARCHAR(100) NOT NULL,
          emoji VARCHAR(10) NOT NULL,
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL
        )
      ', schema_name);

      -- Groups table
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

      -- Group participants table
      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.group_participants (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          group_id UUID NOT NULL,
          participant_jid VARCHAR(100) NOT NULL,
          is_admin BOOLEAN DEFAULT false,
          joined_at TIMESTAMPTZ DEFAULT now() NOT NULL
        )
      ', schema_name);

      -- Status updates table
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

      -- Audit logs table
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

      -- Notification preferences table
      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.notification_preferences (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          user_id UUID NOT NULL UNIQUE,
          sound_enabled BOOLEAN DEFAULT true,
          sound_choice VARCHAR(50) DEFAULT ''default'',
          quiet_hours_start TIME,
          quiet_hours_end TIME,
          muted_contacts UUID[],
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
        )
      ', schema_name);

      -- Create indexes
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.contacts (jid)', schema_name || '_contacts_jid_idx', schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.contacts (phone_number)', schema_name || '_contacts_phone_idx', schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.messages (contact_id)', schema_name || '_messages_contact_idx', schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.messages (timestamp)', schema_name || '_messages_timestamp_idx', schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.messages USING gin(search_vector)', schema_name || '_messages_search_idx', schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.audit_logs (user_id)', schema_name || '_audit_user_idx', schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.audit_logs (created_at)', schema_name || '_audit_created_idx', schema_name);
    END;
    $$ LANGUAGE plpgsql;
  `.execute(db)

  // Add name and connection_order columns to existing tenant schemas
  // This uses a DO block to iterate through all tenant schemas
  await sql`
    DO $$
    DECLARE
      schema_record RECORD;
    BEGIN
      FOR schema_record IN
        SELECT schema_name
        FROM public.companies
        WHERE schema_name IS NOT NULL
      LOOP
        -- Add name column if not exists
        EXECUTE format('
          ALTER TABLE %I.whatsapp_connections
          ADD COLUMN IF NOT EXISTS name VARCHAR(100)
        ', schema_record.schema_name);

        -- Add connection_order column if not exists
        EXECUTE format('
          ALTER TABLE %I.whatsapp_connections
          ADD COLUMN IF NOT EXISTS connection_order INTEGER DEFAULT 0
        ', schema_record.schema_name);

        -- Remove session_data column if exists (no longer needed with PostgreSQL sessions)
        EXECUTE format('
          ALTER TABLE %I.whatsapp_connections
          DROP COLUMN IF EXISTS session_data
        ', schema_record.schema_name);
      END LOOP;
    END $$;
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Revert tenant schema changes
  await sql`
    DO $$
    DECLARE
      schema_record RECORD;
    BEGIN
      FOR schema_record IN
        SELECT schema_name
        FROM public.companies
        WHERE schema_name IS NOT NULL
      LOOP
        EXECUTE format('
          ALTER TABLE %I.whatsapp_connections
          DROP COLUMN IF EXISTS name
        ', schema_record.schema_name);

        EXECUTE format('
          ALTER TABLE %I.whatsapp_connections
          DROP COLUMN IF EXISTS connection_order
        ', schema_record.schema_name);

        EXECUTE format('
          ALTER TABLE %I.whatsapp_connections
          ADD COLUMN IF NOT EXISTS session_data BYTEA
        ', schema_record.schema_name);
      END LOOP;
    END $$;
  `.execute(db)

  // Remove max_whatsapp_connections from companies
  await sql`ALTER TABLE public.companies DROP COLUMN IF EXISTS max_whatsapp_connections`.execute(db)

  // Drop whatsapp_sessions schema and all its tables
  await sql`DROP SCHEMA IF EXISTS whatsapp_sessions CASCADE`.execute(db)

  // Restore original setup_tenant_schema function
  await sql`
    CREATE OR REPLACE FUNCTION setup_tenant_schema(schema_name TEXT)
    RETURNS void AS $$
    BEGIN
      -- Create the schema
      EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', schema_name);

      -- WhatsApp connections table
      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.whatsapp_connections (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          phone_number VARCHAR(20),
          jid VARCHAR(100),
          status whatsapp_connection_status DEFAULT ''pending'' NOT NULL,
          connected_by UUID,
          connected_at TIMESTAMPTZ,
          last_sync_at TIMESTAMPTZ,
          session_data BYTEA,
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
        )
      ', schema_name);

      -- Contacts table
      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.contacts (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          whatsapp_connection_id UUID,
          jid VARCHAR(100),
          phone_number VARCHAR(20),
          push_name VARCHAR(255),
          custom_name VARCHAR(255),
          notes_shared TEXT,
          is_group BOOLEAN DEFAULT false,
          profile_picture_url TEXT,
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
        )
      ', schema_name);

      -- Tags table
      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.tags (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          name VARCHAR(100) NOT NULL,
          color VARCHAR(7),
          created_by UUID,
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL
        )
      ', schema_name);

      -- Contact tags junction table
      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.contact_tags (
          contact_id UUID NOT NULL,
          tag_id UUID NOT NULL,
          PRIMARY KEY (contact_id, tag_id)
        )
      ', schema_name);

      -- Contact assignments table
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

      -- Private contact notes table
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

      -- Messages table (with status column for delivery receipts)
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
          quoted_message_id VARCHAR(100),
          is_forwarded BOOLEAN DEFAULT false,
          is_starred BOOLEAN DEFAULT false,
          deleted_by_sender BOOLEAN DEFAULT false,
          deleted_at TIMESTAMPTZ,
          sent_by_user_id UUID,
          status message_status DEFAULT ''sent'',
          timestamp TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
          search_vector TSVECTOR
        )
      ', schema_name);

      -- Message reactions table
      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.message_reactions (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          message_id UUID NOT NULL,
          reactor_jid VARCHAR(100) NOT NULL,
          emoji VARCHAR(10) NOT NULL,
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL
        )
      ', schema_name);

      -- Groups table
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

      -- Group participants table
      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.group_participants (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          group_id UUID NOT NULL,
          participant_jid VARCHAR(100) NOT NULL,
          is_admin BOOLEAN DEFAULT false,
          joined_at TIMESTAMPTZ DEFAULT now() NOT NULL
        )
      ', schema_name);

      -- Status updates table
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

      -- Audit logs table
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

      -- Notification preferences table
      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.notification_preferences (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          user_id UUID NOT NULL UNIQUE,
          sound_enabled BOOLEAN DEFAULT true,
          sound_choice VARCHAR(50) DEFAULT ''default'',
          quiet_hours_start TIME,
          quiet_hours_end TIME,
          muted_contacts UUID[],
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
        )
      ', schema_name);

      -- Create indexes
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.contacts (jid)', schema_name || '_contacts_jid_idx', schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.contacts (phone_number)', schema_name || '_contacts_phone_idx', schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.messages (contact_id)', schema_name || '_messages_contact_idx', schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.messages (timestamp)', schema_name || '_messages_timestamp_idx', schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.messages USING gin(search_vector)', schema_name || '_messages_search_idx', schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.audit_logs (user_id)', schema_name || '_audit_user_idx', schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.audit_logs (created_at)', schema_name || '_audit_created_idx', schema_name);
    END;
    $$ LANGUAGE plpgsql;
  `.execute(db)
}
