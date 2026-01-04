import type { Kysely } from "kysely";
import { sql } from "kysely";

/**
 * Migration 011: Add name column to whatsapp_connections table
 *
 * This migration:
 * 1. Adds the 'name' column to whatsapp_connections in all existing tenant schemas
 * 2. Updates the setup_tenant_schema function to include the name column for new tenants
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // Get all tenant schemas
  const schemas = await sql<{ schema_name: string }>`
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name LIKE 'tenant_%'
  `.execute(db);

  // Add name column to each existing tenant schema
  for (const { schema_name } of schemas.rows) {
    // Check if column already exists
    const columnExists = await sql<{ exists: boolean }>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = ${schema_name}
        AND table_name = 'whatsapp_connections'
        AND column_name = 'name'
      ) as exists
    `.execute(db);

    if (!columnExists.rows[0]?.exists) {
      await sql`
        ALTER TABLE ${sql.raw(`"${schema_name}".whatsapp_connections`)}
        ADD COLUMN IF NOT EXISTS name VARCHAR(100)
      `.execute(db);

      console.log(`Added name column to ${schema_name}.whatsapp_connections`);
    }

    // Create whatsmeow_lid_mappings table if it doesn't exist
    const tableExists = await sql<{ exists: boolean }>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = ${schema_name}
        AND table_name = 'whatsmeow_lid_mappings'
      ) as exists
    `.execute(db);

    if (!tableExists.rows[0]?.exists) {
      await sql`
        CREATE TABLE ${sql.raw(`"${schema_name}".whatsmeow_lid_mappings`)} (
          connection_id VARCHAR(100) NOT NULL,
          lid VARCHAR(100) NOT NULL,
          jid VARCHAR(100) NOT NULL,
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
          PRIMARY KEY (connection_id, lid)
        )
      `.execute(db);

      console.log(`Created whatsmeow_lid_mappings table in ${schema_name}`);
    }
  }

  // Update setup_tenant_schema function to include name column for new tenants
  await sql`
    CREATE OR REPLACE FUNCTION setup_tenant_schema(schema_name TEXT)
    RETURNS void AS $$
    BEGIN
      -- Create the schema
      EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', schema_name);

      -- WhatsApp connections table (with name column)
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
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
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

      -- Private notes table
      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.contact_notes_private (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          contact_id UUID NOT NULL,
          user_id UUID NOT NULL,
          content TEXT NOT NULL,
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

      -- Group members table
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

      -- Quick replies table
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

      -- Conversation states table
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

      -- WhatsApp labels table
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

      -- WhatsApp label associations table
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

      -- WhatsApp catalogs table
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

      -- Catalog products table
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

      -- Notification history table
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

      -- WhatsApp LID (Linked ID) mappings table for whatsmeow
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
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_contacts_jid ON %I.contacts(jid)', replace(schema_name, '-', '_'), schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_contacts_wa_conn ON %I.contacts(whatsapp_connection_id)', replace(schema_name, '-', '_'), schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_messages_contact ON %I.messages(contact_id)', replace(schema_name, '-', '_'), schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_messages_wa_conn ON %I.messages(whatsapp_connection_id)', replace(schema_name, '-', '_'), schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_messages_timestamp ON %I.messages(timestamp DESC)', replace(schema_name, '-', '_'), schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_messages_message_id ON %I.messages(message_id)', replace(schema_name, '-', '_'), schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_audit_logs_user ON %I.audit_logs(user_id)', replace(schema_name, '-', '_'), schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_audit_logs_created ON %I.audit_logs(created_at DESC)', replace(schema_name, '-', '_'), schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_conv_states_contact ON %I.conversation_states(contact_id)', replace(schema_name, '-', '_'), schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_conv_states_last_msg ON %I.conversation_states(last_message_at DESC)', replace(schema_name, '-', '_'), schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_label_assoc_label ON %I.whatsapp_label_associations(label_id)', replace(schema_name, '-', '_'), schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_label_assoc_contact ON %I.whatsapp_label_associations(contact_id)', replace(schema_name, '-', '_'), schema_name);
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_catalog_products_catalog ON %I.catalog_products(catalog_id)', replace(schema_name, '-', '_'), schema_name);
    END;
    $$ LANGUAGE plpgsql;
  `.execute(db);

  console.log("Updated setup_tenant_schema function with name column");
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Get all tenant schemas
  const schemas = await sql<{ schema_name: string }>`
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name LIKE 'tenant_%'
  `.execute(db);

  // Remove name column from each tenant schema
  for (const { schema_name } of schemas.rows) {
    await sql`
      ALTER TABLE ${sql.raw(`"${schema_name}".whatsapp_connections`)}
      DROP COLUMN IF EXISTS name
    `.execute(db);
  }

  // Note: We don't restore the old setup_tenant_schema function
  // as other migrations may have updated it
}
