import type { Kysely } from "kysely";
import { sql } from "kysely";
import { addColumnToAllTenants, executeOnAllTenants } from "./migration-helpers.js";

/**
 * Migration 017: Add contact presence tracking
 *
 * PURPOSE:
 * Add columns to track WhatsApp contact presence (online/offline status and last seen)
 * This enables real-time status updates when contacts come online or go offline.
 *
 * CHANGES:
 * 1. Add is_online column to contacts table (boolean, default false)
 * 2. Add last_seen column to contacts table (timestamptz, nullable)
 * 3. Update setup_tenant_schema function to include these columns for new tenants
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  console.log("Adding presence columns to contacts table in all tenant schemas...");

  // Add is_online column to all existing tenant schemas
  await addColumnToAllTenants(
    db,
    "contacts",
    "is_online",
    "BOOLEAN DEFAULT false NOT NULL",
  );

  // Add last_seen column to all existing tenant schemas
  await addColumnToAllTenants(
    db,
    "contacts",
    "last_seen",
    "TIMESTAMPTZ",
  );

  console.log("Adding performance index for presence queries...");

  // Add index for presence queries (filtering by is_online, sorting by last_seen)
  // This helps queries that need to show online contacts or sort by last seen time
  await executeOnAllTenants(db, async (schemaName) => {
    const safeSchemaName = schemaName.replace(/-/g, "_");
    const indexName = `idx_${safeSchemaName.substring(0, 40)}_contacts_presence`;

    await sql`
      CREATE INDEX IF NOT EXISTS ${sql.raw(indexName)}
      ON ${sql.raw(`"${schemaName}".contacts`)} (is_online, last_seen DESC NULLS LAST)
    `.execute(db);
  });

  console.log("Updating setup_tenant_schema function to include presence columns...");

  // Update the setup_tenant_schema function to include these columns for new tenants
  // We need to read the existing function and update the contacts table definition
  await sql`
    CREATE OR REPLACE FUNCTION setup_tenant_schema(schema_name TEXT)
    RETURNS void AS $$
    DECLARE
      safe_schema_name TEXT;
    BEGIN
      -- Sanitize schema name for use in index names (PostgreSQL index names have 63 char limit)
      safe_schema_name := replace(schema_name, '-', '_');

      -- Create the schema
      EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', schema_name);

      -- WhatsApp connections table
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

      -- Contacts table (with presence tracking)
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
          is_online BOOLEAN DEFAULT false NOT NULL,
          last_seen TIMESTAMPTZ,
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

      -- Messages table
      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.messages (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          contact_id UUID NOT NULL,
          message_id VARCHAR(255),
          from_me BOOLEAN DEFAULT false,
          content TEXT,
          timestamp TIMESTAMPTZ DEFAULT now() NOT NULL,
          status message_status DEFAULT ''sent'',
          metadata JSONB,
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL
        )
      ', schema_name);

      -- Notification history table
      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.notification_history (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          contact_id UUID NOT NULL,
          message_id UUID NOT NULL,
          notification_type notification_type NOT NULL,
          sent_to UUID NOT NULL,
          sent_at TIMESTAMPTZ DEFAULT now() NOT NULL,
          acknowledged_at TIMESTAMPTZ
        )
      ', schema_name);

      -- Quick replies table
      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.quick_replies (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          shortcut VARCHAR(50) NOT NULL UNIQUE,
          content TEXT NOT NULL,
          created_by UUID NOT NULL,
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
        )
      ', schema_name);

      -- Conversation states table
      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.conversation_states (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          contact_id UUID NOT NULL UNIQUE,
          state conversation_status DEFAULT ''open'' NOT NULL,
          resolved_by UUID,
          resolved_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
        )
      ', schema_name);

      -- WhatsApp labels table
      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.whatsapp_labels (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          label_id VARCHAR(100) NOT NULL,
          name VARCHAR(255) NOT NULL,
          color VARCHAR(7),
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
        )
      ', schema_name);

      -- Contact labels junction table
      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.contact_labels (
          contact_id UUID NOT NULL,
          label_id UUID NOT NULL,
          PRIMARY KEY (contact_id, label_id)
        )
      ', schema_name);

      -- WhatsApp catalog table
      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.whatsapp_catalogs (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          catalog_id VARCHAR(100) NOT NULL,
          name VARCHAR(255) NOT NULL,
          is_default BOOLEAN DEFAULT false,
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
        )
      ', schema_name);

      -- WhatsApp products table
      EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.whatsapp_products (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          catalog_id UUID NOT NULL,
          product_id VARCHAR(100) NOT NULL,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          price DECIMAL(10, 2),
          currency VARCHAR(3),
          image_url TEXT,
          url TEXT,
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
        )
      ', schema_name);

      -- Create performance indexes
      EXECUTE format('
        CREATE INDEX IF NOT EXISTS %I
        ON %I.messages (contact_id, timestamp DESC)
      ', 'idx_' || substring(safe_schema_name from 1 for 40) || '_msg_contact_ts', schema_name);

      EXECUTE format('
        CREATE INDEX IF NOT EXISTS %I
        ON %I.contact_assignments (assigned_to)
        WHERE unassigned_at IS NULL
      ', 'idx_' || substring(safe_schema_name from 1 for 40) || '_contact_assign', schema_name);

      EXECUTE format('
        CREATE INDEX IF NOT EXISTS %I
        ON %I.messages (contact_id, from_me)
        WHERE from_me = false
      ', 'idx_' || substring(safe_schema_name from 1 for 40) || '_msg_incoming', schema_name);

      EXECUTE format('
        CREATE INDEX IF NOT EXISTS %I
        ON %I.messages (message_id)
      ', 'idx_' || substring(safe_schema_name from 1 for 40) || '_msg_id', schema_name);

      EXECUTE format('
        CREATE INDEX IF NOT EXISTS %I
        ON %I.contacts (is_online, last_seen DESC NULLS LAST)
      ', 'idx_' || substring(safe_schema_name from 1 for 40) || '_contacts_presence', schema_name);

    END;
    $$ LANGUAGE plpgsql;
  `.execute(db);

  console.log("Contact presence columns added successfully!");
}

export async function down(db: Kysely<unknown>): Promise<void> {
  console.log("Removing presence columns from contacts table in all tenant schemas...");

  // Get all tenant schemas
  const schemas = await sql<{ schema_name: string }>`
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name LIKE 'tenant_%'
    ORDER BY schema_name
  `.execute(db);

  // Remove columns from each tenant schema
  for (const { schema_name } of schemas.rows) {
    console.log(`Removing presence columns from ${schema_name}.contacts`);

    await sql`
      ALTER TABLE ${sql.raw(`"${schema_name}".contacts`)}
      DROP COLUMN IF EXISTS is_online,
      DROP COLUMN IF EXISTS last_seen
    `.execute(db);
  }

  console.log("Contact presence columns removed successfully!");
}
