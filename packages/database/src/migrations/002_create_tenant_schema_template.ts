import { Kysely, sql } from 'kysely'

/**
 * This migration creates the tenant schema template.
 * This template is used when creating new tenant schemas.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // Create custom types for tenant schema
  await sql`
    DO $$ BEGIN
      CREATE TYPE whatsapp_connection_status AS ENUM ('connected', 'disconnected', 'banned', 'pending');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$
  `.execute(db)

  await sql`
    DO $$ BEGIN
      CREATE TYPE message_type AS ENUM ('text', 'image', 'video', 'audio', 'document', 'sticker', 'location', 'contact', 'reaction');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$
  `.execute(db)

  // Create function to setup tenant schema with all required tables
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

      -- Messages table
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

  // Create function to drop tenant schema
  await sql`
    CREATE OR REPLACE FUNCTION drop_tenant_schema(schema_name TEXT)
    RETURNS void AS $$
    BEGIN
      EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', schema_name);
    END;
    $$ LANGUAGE plpgsql;
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP FUNCTION IF EXISTS drop_tenant_schema`.execute(db)
  await sql`DROP FUNCTION IF EXISTS setup_tenant_schema`.execute(db)
  await sql`DROP TYPE IF EXISTS message_type`.execute(db)
  await sql`DROP TYPE IF EXISTS whatsapp_connection_status`.execute(db)
}
