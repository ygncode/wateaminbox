import { Kysely, sql, PostgresDialect } from "kysely";
import { Pool } from "pg";
import {
  TenantDatabase as TenantDatabaseType,
  getTenantSchemaName,
} from "@whatsapp-web/database";

export type TenantDatabase = TenantDatabaseType;

const DATABASE_URL = process.env.DATABASE_URL || "";

// Cache for tenant connections
const tenantConnections = new Map<string, Kysely<TenantDatabase>>();

/**
 * Get schema name for a company
 */
export function getSchemaName(companyId: string): string {
  return getTenantSchemaName(companyId);
}

/**
 * Get or create a tenant database connection
 */
export function getTenantConnection(companyId: string): Kysely<TenantDatabase> {
  const schemaName = getSchemaName(companyId);

  let connection = tenantConnections.get(companyId);
  if (connection) {
    return connection;
  }

  const dialect = new PostgresDialect({
    pool: new Pool({
      connectionString: DATABASE_URL,
      max: 5,
    }),
  });

  connection = new Kysely<TenantDatabase>({
    dialect,
  }).withSchema(schemaName) as Kysely<TenantDatabase>;

  tenantConnections.set(companyId, connection);
  return connection;
}

/**
 * Clear a tenant connection from cache
 */
export async function clearTenantConnection(companyId: string): Promise<void> {
  const connection = tenantConnections.get(companyId);
  if (connection) {
    await connection.destroy();
    tenantConnections.delete(companyId);
  }
}

/**
 * Clear all tenant connections
 */
export async function clearAllTenantConnections(): Promise<void> {
  for (const [companyId] of tenantConnections) {
    await clearTenantConnection(companyId);
  }
}

/**
 * Check if a tenant schema exists
 */
export async function tenantSchemaExists(companyId: string): Promise<boolean> {
  const schemaName = getSchemaName(companyId);

  const dialect = new PostgresDialect({
    pool: new Pool({
      connectionString: DATABASE_URL,
      max: 1,
    }),
  });

  const db = new Kysely<Record<string, unknown>>({ dialect });

  try {
    const result = await sql<{ exists: boolean }>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.schemata
        WHERE schema_name = ${schemaName}
      )
    `.execute(db);

    await db.destroy();
    return result.rows[0]?.exists ?? false;
  } catch {
    await db.destroy();
    return false;
  }
}

/**
 * Create a tenant schema with all required tables
 */
export async function createTenantSchema(companyId: string): Promise<void> {
  const schemaName = getSchemaName(companyId);

  const dialect = new PostgresDialect({
    pool: new Pool({
      connectionString: DATABASE_URL,
      max: 1,
    }),
  });

  const db = new Kysely<Record<string, unknown>>({ dialect });

  try {
    // Create schema
    await sql`CREATE SCHEMA IF NOT EXISTS ${sql.ref(schemaName)}`.execute(db);

    // Create tables in the tenant schema
    await sql`
      CREATE TABLE IF NOT EXISTS ${sql.ref(schemaName)}.whatsapp_connections (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        phone_number VARCHAR(20),
        jid VARCHAR(50),
        status VARCHAR(20) DEFAULT 'disconnected',
        connected_by UUID,
        connected_at TIMESTAMP,
        last_sync_at TIMESTAMP,
        session_data BYTEA,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `.execute(db);

    await sql`
      CREATE TABLE IF NOT EXISTS ${sql.ref(schemaName)}.contacts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        whatsapp_connection_id UUID,
        jid VARCHAR(50),
        phone_number VARCHAR(20),
        push_name VARCHAR(255),
        custom_name VARCHAR(255),
        notes_shared TEXT,
        is_group BOOLEAN DEFAULT FALSE,
        profile_picture_url TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `.execute(db);

    await sql`
      CREATE TABLE IF NOT EXISTS ${sql.ref(schemaName)}.tags (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        color VARCHAR(7),
        whatsapp_label_id VARCHAR(100),
        synced_at TIMESTAMP,
        created_by UUID,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `.execute(db);

    await sql`
      CREATE TABLE IF NOT EXISTS ${sql.ref(schemaName)}.contact_tags (
        contact_id UUID NOT NULL,
        tag_id UUID NOT NULL,
        PRIMARY KEY (contact_id, tag_id)
      )
    `.execute(db);

    await sql`
      CREATE TABLE IF NOT EXISTS ${sql.ref(schemaName)}.contact_assignments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contact_id UUID NOT NULL,
        assigned_to UUID NOT NULL,
        assigned_by UUID NOT NULL,
        assigned_at TIMESTAMP DEFAULT NOW(),
        unassigned_at TIMESTAMP
      )
    `.execute(db);

    await sql`
      CREATE TABLE IF NOT EXISTS ${sql.ref(schemaName)}.contact_notes_private (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contact_id UUID NOT NULL,
        user_id UUID NOT NULL,
        content TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `.execute(db);

    await sql`
      CREATE TABLE IF NOT EXISTS ${sql.ref(schemaName)}.messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        whatsapp_connection_id UUID,
        contact_id UUID,
        message_id VARCHAR(100),
        from_me BOOLEAN NOT NULL,
        sender_jid VARCHAR(50),
        message_type VARCHAR(20) NOT NULL,
        content TEXT,
        media_url TEXT,
        media_mime_type VARCHAR(100),
        media_size INTEGER,
        quoted_message_id VARCHAR(100),
        is_forwarded BOOLEAN DEFAULT FALSE,
        is_starred BOOLEAN DEFAULT FALSE,
        deleted_by_sender BOOLEAN DEFAULT FALSE,
        deleted_at TIMESTAMP,
        sent_by_user_id UUID,
        timestamp TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        search_vector TSVECTOR
      )
    `.execute(db);

    await sql`
      CREATE TABLE IF NOT EXISTS ${sql.ref(schemaName)}.message_reactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        message_id UUID NOT NULL,
        reactor_jid VARCHAR(50) NOT NULL,
        emoji VARCHAR(10) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `.execute(db);

    await sql`
      CREATE TABLE IF NOT EXISTS ${sql.ref(schemaName)}.groups (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contact_id UUID,
        jid VARCHAR(50),
        name VARCHAR(255),
        description TEXT,
        created_by VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW(),
        participant_count INTEGER DEFAULT 0
      )
    `.execute(db);

    await sql`
      CREATE TABLE IF NOT EXISTS ${sql.ref(schemaName)}.group_participants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        group_id UUID NOT NULL,
        participant_jid VARCHAR(50) NOT NULL,
        is_admin BOOLEAN DEFAULT FALSE,
        joined_at TIMESTAMP DEFAULT NOW()
      )
    `.execute(db);

    await sql`
      CREATE TABLE IF NOT EXISTS ${sql.ref(schemaName)}.status_updates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        whatsapp_connection_id UUID,
        status_id VARCHAR(100),
        from_jid VARCHAR(50),
        media_type VARCHAR(20),
        media_url TEXT,
        caption TEXT,
        timestamp TIMESTAMP NOT NULL,
        expires_at TIMESTAMP NOT NULL
      )
    `.execute(db);

    await sql`
      CREATE TABLE IF NOT EXISTS ${sql.ref(schemaName)}.audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID,
        action VARCHAR(50) NOT NULL,
        entity_type VARCHAR(50),
        entity_id UUID,
        details JSONB,
        ip_address VARCHAR(45),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `.execute(db);

    await sql`
      CREATE TABLE IF NOT EXISTS ${sql.ref(schemaName)}.notification_preferences (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL UNIQUE,
        sound_enabled BOOLEAN DEFAULT TRUE,
        sound_choice VARCHAR(50) DEFAULT 'default',
        quiet_hours_start TIME,
        quiet_hours_end TIME,
        muted_contacts TEXT[],
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `.execute(db);

    // Notification history table
    await sql`
      CREATE TABLE IF NOT EXISTS ${sql.ref(schemaName)}.notification_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        notification_type VARCHAR(50) NOT NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT,
        action_url TEXT,
        metadata JSONB,
        is_read BOOLEAN DEFAULT FALSE,
        read_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `.execute(db);

    // Quick replies table
    await sql`
      CREATE TABLE IF NOT EXISTS ${sql.ref(schemaName)}.quick_replies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        shortcut VARCHAR(50) NOT NULL,
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        created_by UUID NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `.execute(db);

    // WhatsApp labels table
    await sql`
      CREATE TABLE IF NOT EXISTS ${sql.ref(schemaName)}.whatsapp_labels (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        label_id VARCHAR(100) NOT NULL UNIQUE,
        name VARCHAR(100) NOT NULL,
        color VARCHAR(20),
        predefined_id INTEGER,
        synced_tag_id UUID,
        last_synced_at TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `.execute(db);

    // WhatsApp catalogs table
    await sql`
      CREATE TABLE IF NOT EXISTS ${sql.ref(schemaName)}.whatsapp_catalogs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        catalog_id VARCHAR(100) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        currency VARCHAR(10) DEFAULT 'USD',
        status VARCHAR(20) DEFAULT 'active',
        business_jid VARCHAR(100),
        header_image_url TEXT,
        product_count INTEGER DEFAULT 0,
        last_synced_at TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `.execute(db);

    // Catalog products table
    await sql`
      CREATE TABLE IF NOT EXISTS ${sql.ref(schemaName)}.catalog_products (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id VARCHAR(100) NOT NULL,
        catalog_id VARCHAR(100) NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        price DECIMAL(12, 2),
        currency VARCHAR(10) DEFAULT 'USD',
        image_urls TEXT[],
        sku VARCHAR(100),
        category VARCHAR(255),
        availability VARCHAR(50) DEFAULT 'in_stock',
        visibility VARCHAR(20) DEFAULT 'visible',
        url TEXT,
        retailer_id VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(product_id, catalog_id)
      )
    `.execute(db);

    // Create indexes
    await sql`CREATE INDEX IF NOT EXISTS idx_contacts_jid ON ${sql.ref(schemaName)}.contacts(jid)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_messages_contact_id ON ${sql.ref(schemaName)}.messages(contact_id)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON ${sql.ref(schemaName)}.messages(timestamp)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_messages_search ON ${sql.ref(schemaName)}.messages USING GIN(search_vector)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_notification_history_user ON ${sql.ref(schemaName)}.notification_history(user_id)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_quick_replies_shortcut ON ${sql.ref(schemaName)}.quick_replies(shortcut)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_tags_label_id ON ${sql.ref(schemaName)}.tags(whatsapp_label_id)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_whatsapp_labels_label_id ON ${sql.ref(schemaName)}.whatsapp_labels(label_id)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_whatsapp_catalogs_catalog_id ON ${sql.ref(schemaName)}.whatsapp_catalogs(catalog_id)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_catalog_products_catalog_id ON ${sql.ref(schemaName)}.catalog_products(catalog_id)`.execute(
      db,
    );

    await db.destroy();
  } catch (error) {
    await db.destroy();
    throw error;
  }
}

/**
 * Drop a tenant schema
 */
export async function dropTenantSchema(companyId: string): Promise<void> {
  const schemaName = getSchemaName(companyId);

  // Clear cached connection first
  await clearTenantConnection(companyId);

  const dialect = new PostgresDialect({
    pool: new Pool({
      connectionString: DATABASE_URL,
      max: 1,
    }),
  });

  const db = new Kysely<Record<string, unknown>>({ dialect });

  try {
    await sql`DROP SCHEMA IF EXISTS ${sql.ref(schemaName)} CASCADE`.execute(db);
    await db.destroy();
  } catch (error) {
    await db.destroy();
    throw error;
  }
}
