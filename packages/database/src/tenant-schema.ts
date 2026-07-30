import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { TenantDatabase } from "./client";

/**
 * Runtime contract for tenant tables.
 *
 * Keep this synchronized with TenantDatabase. The type assertion below fails
 * when a table or column is added to the TypeScript model without being added
 * to this contract.
 */
export const TENANT_SCHEMA_CONTRACT = {
  whatsapp_connections: [
    "id",
    "name",
    "phone_number",
    "jid",
    "status",
    "connected_by",
    "connected_at",
    "last_sync_at",
    "sync_status",
    "sync_message_count",
    "sync_conversation_count",
    "qr_code",
    "qr_expires_at",
    "archived_at",
    "created_at",
    "updated_at",
  ],
  whatsapp_connection_sessions: [
    "id",
    "whatsapp_connection_id",
    "status",
    "created_by",
    "expected_phone_number",
    "started_at",
    "connected_at",
    "ended_at",
    "end_reason",
    "created_at",
    "updated_at",
  ],
  contacts: [
    "id",
    "whatsapp_connection_id",
    "jid",
    "phone_number",
    "push_name",
    "custom_name",
    "notes_shared",
    "is_group",
    "is_online",
    "last_seen",
    "is_blocked",
    "profile_picture_url",
    "remote_history_status",
    "remote_history_updated_at",
    "created_at",
    "updated_at",
  ],
  tags: [
    "id",
    "name",
    "color",
    "whatsapp_label_id",
    "synced_at",
    "created_by",
    "created_at",
  ],
  whatsapp_labels: [
    "id",
    "whatsapp_connection_id",
    "label_id",
    "name",
    "color",
    "predefined_id",
    "synced_tag_id",
    "last_synced_at",
    "created_at",
    "updated_at",
  ],
  whatsapp_catalogs: [
    "id",
    "whatsapp_connection_id",
    "catalog_id",
    "name",
    "description",
    "currency",
    "status",
    "business_jid",
    "header_image_url",
    "product_count",
    "last_synced_at",
    "created_at",
    "updated_at",
  ],
  catalog_products: [
    "id",
    "whatsapp_connection_id",
    "product_id",
    "catalog_id",
    "name",
    "description",
    "price",
    "currency",
    "image_urls",
    "sku",
    "category",
    "availability",
    "visibility",
    "url",
    "retailer_id",
    "created_at",
    "updated_at",
  ],
  contact_tags: ["contact_id", "tag_id"],
  contact_assignments: [
    "id",
    "contact_id",
    "assigned_to",
    "assigned_by",
    "assigned_at",
    "unassigned_at",
  ],
  contact_notes_private: [
    "id",
    "contact_id",
    "user_id",
    "content",
    "created_at",
    "updated_at",
  ],
  contact_notes_shared: [
    "id",
    "contact_id",
    "user_id",
    "author_name",
    "content",
    "created_at",
    "updated_at",
  ],
  messages: [
    "id",
    "whatsapp_connection_id",
    "contact_id",
    "message_id",
    "from_me",
    "sender_jid",
    "sender_name",
    "sender_avatar_url",
    "message_type",
    "content",
    "media_url",
    "media_mime_type",
    "media_size",
    "media_direct_path",
    "media_key",
    "media_file_sha256",
    "media_file_enc_sha256",
    "media_download_status",
    "media_download_error",
    "media_downloaded_at",
    "quoted_message_id",
    "is_forwarded",
    "is_starred",
    "deleted_by_sender",
    "deleted_at",
    "sent_by_user_id",
    "status",
    "metadata",
    "timestamp",
    "created_at",
    "search_vector",
  ],
  message_reactions: ["id", "message_id", "reactor_jid", "emoji", "created_at"],
  groups: [
    "id",
    "contact_id",
    "jid",
    "name",
    "description",
    "created_by",
    "created_at",
    "participant_count",
  ],
  group_participants: [
    "id",
    "group_id",
    "participant_jid",
    "is_admin",
    "joined_at",
  ],
  status_updates: [
    "id",
    "whatsapp_connection_id",
    "status_id",
    "from_jid",
    "media_type",
    "media_url",
    "caption",
    "timestamp",
    "expires_at",
  ],
  audit_logs: [
    "id",
    "user_id",
    "action",
    "entity_type",
    "entity_id",
    "details",
    "ip_address",
    "created_at",
  ],
  notification_preferences: [
    "id",
    "user_id",
    "sound_enabled",
    "sound_choice",
    "quiet_hours_start",
    "quiet_hours_end",
    "muted_contacts",
    "notifications_enabled",
    "timezone",
    "created_at",
    "updated_at",
  ],
  notification_history: [
    "id",
    "user_id",
    "notification_type",
    "title",
    "message",
    "action_url",
    "metadata",
    "is_read",
    "read_at",
    "created_at",
  ],
  push_subscriptions: [
    "id",
    "user_id",
    "endpoint",
    "p256dh",
    "auth",
    "user_agent",
    "created_at",
    "updated_at",
    "last_used_at",
  ],
  quick_replies: [
    "id",
    "shortcut",
    "title",
    "content",
    "created_by",
    "created_at",
    "updated_at",
  ],
  conversation_states: [
    "id",
    "contact_id",
    "read_by_user_id",
    "read_at",
    "last_message_at",
    "last_message_preview",
    "unread_count",
    "status",
    "resolved_at",
    "resolved_by",
    "reopened_at",
    "reopened_by",
    "resolution_notes",
    "created_at",
    "updated_at",
  ],
  nats_outbox: [
    "id",
    "subject",
    "payload",
    "status",
    "attempts",
    "next_attempt_at",
    "last_error",
    "created_at",
    "published_at",
  ],
  scheduled_messages: [
    "id",
    "contact_id",
    "content",
    "message_type",
    "reply_to_message_id",
    "scheduled_at",
    "status",
    "attempts",
    "next_attempt_at",
    "last_error",
    "sent_message_id",
    "created_by",
    "canceled_by",
    "canceled_at",
    "sent_at",
    "created_at",
    "updated_at",
  ],
} as const satisfies {
  [Table in keyof TenantDatabase]: readonly Extract<
    keyof TenantDatabase[Table],
    string
  >[];
};

type MissingContractColumns = {
  [Table in keyof TenantDatabase]: Exclude<
    Extract<keyof TenantDatabase[Table], string>,
    (typeof TENANT_SCHEMA_CONTRACT)[Table][number]
  >;
}[keyof TenantDatabase];
type AssertNoMissingColumns<T extends never> = T;
export type TenantSchemaContractIsComplete =
  AssertNoMissingColumns<MissingContractColumns>;

async function tenantColumnExists<Database>(
  db: Kysely<Database>,
  schemaName: string,
  tableName: string,
  columnName: string,
): Promise<boolean> {
  const result = await sql<{ exists: boolean }>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = ${schemaName}
        AND table_name = ${tableName}
        AND column_name = ${columnName}
    ) AS exists
  `.execute(db);
  return result.rows[0]?.exists ?? false;
}

async function tenantConstraintExists<Database>(
  db: Kysely<Database>,
  schemaName: string,
  tableName: string,
  constraintName: string,
): Promise<boolean> {
  const result = await sql<{ exists: boolean }>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_constraint AS constraint_record
      JOIN pg_class AS table_record
        ON table_record.oid = constraint_record.conrelid
      JOIN pg_namespace AS schema_record
        ON schema_record.oid = table_record.relnamespace
      WHERE schema_record.nspname = ${schemaName}
        AND table_record.relname = ${tableName}
        AND constraint_record.conname = ${constraintName}
    ) AS exists
  `.execute(db);
  return result.rows[0]?.exists ?? false;
}

/**
 * Bring a newly-created tenant schema up to the current application contract.
 *
 * Historical migrations retain their setup_tenant_schema definitions because
 * applied migrations are immutable. New additive tenant migrations should
 * update existing schemas and add an idempotent guard here instead of copying
 * the complete PostgreSQL setup function again.
 */
export async function reconcileTenantSchema<Database>(
  db: Kysely<Database>,
  schemaName: string,
): Promise<void> {
  const table = (name: keyof TenantDatabase) =>
    sql.table(`${schemaName}.${String(name)}`);

  await sql`
    ALTER TABLE ${table("contacts")}
    ADD COLUMN IF NOT EXISTS remote_history_status TEXT NOT NULL DEFAULT 'unknown',
    ADD COLUMN IF NOT EXISTS remote_history_updated_at TIMESTAMPTZ
  `.execute(db);
  await sql`
    ALTER TABLE ${table("contacts")}
    DROP CONSTRAINT IF EXISTS contacts_remote_history_status_check,
    ADD CONSTRAINT contacts_remote_history_status_check
    CHECK (remote_history_status IN (
      'unknown',
      'available',
      'requesting',
      'exhausted',
      'unavailable',
      'failed'
    ))
  `.execute(db);

  // The latest historical setup function regressed several label/catalog
  // columns. Normalize its legacy label identifier before adding the current
  // fields so inserts don't have to satisfy two NOT NULL identifier columns.
  const hasLabelId = await tenantColumnExists(
    db,
    schemaName,
    "whatsapp_labels",
    "label_id",
  );
  const hasLegacyLabelId = await tenantColumnExists(
    db,
    schemaName,
    "whatsapp_labels",
    "whatsapp_label_id",
  );
  if (!hasLabelId && hasLegacyLabelId) {
    await sql`
      ALTER TABLE ${table("whatsapp_labels")}
      RENAME COLUMN ${sql.ref("whatsapp_label_id")} TO ${sql.ref("label_id")}
    `.execute(db);
  } else if (hasLabelId && hasLegacyLabelId) {
    await sql`
      UPDATE ${table("whatsapp_labels")}
      SET label_id = COALESCE(label_id, whatsapp_label_id)
    `.execute(db);
    await sql`
      ALTER TABLE ${table("whatsapp_labels")}
      DROP COLUMN ${sql.ref("whatsapp_label_id")} CASCADE
    `.execute(db);
  }

  await sql`
    ALTER TABLE ${table("tags")}
    ADD COLUMN IF NOT EXISTS whatsapp_label_id VARCHAR(100),
    ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ
  `.execute(db);
  await sql`
    ALTER TABLE ${table("whatsapp_labels")}
    ADD COLUMN IF NOT EXISTS label_id VARCHAR(100),
    ADD COLUMN IF NOT EXISTS whatsapp_connection_id UUID,
    ADD COLUMN IF NOT EXISTS synced_tag_id UUID,
    ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
  `.execute(db);
  await sql`
    UPDATE ${table("whatsapp_labels")}
    SET label_id = id::text
    WHERE label_id IS NULL
  `.execute(db);
  await sql`
    ALTER TABLE ${table("whatsapp_labels")}
    ALTER COLUMN label_id SET NOT NULL
  `.execute(db);
  await sql`
    UPDATE ${table("whatsapp_labels")}
    SET whatsapp_connection_id = (
      SELECT id
      FROM ${table("whatsapp_connections")}
      ORDER BY (status = 'connected') DESC, created_at ASC
      LIMIT 1
    )
    WHERE whatsapp_connection_id IS NULL
  `.execute(db);
  await sql`
    ALTER TABLE ${table("whatsapp_labels")}
    DROP CONSTRAINT IF EXISTS ${sql.ref("whatsapp_labels_label_id_key")},
    DROP CONSTRAINT IF EXISTS ${sql.ref("unique_whatsapp_label")}
  `.execute(db);
  if (
    !(await tenantConstraintExists(
      db,
      schemaName,
      "whatsapp_labels",
      "whatsapp_labels_connection_fk",
    ))
  ) {
    await sql`
      ALTER TABLE ${table("whatsapp_labels")}
      ADD CONSTRAINT whatsapp_labels_connection_fk
      FOREIGN KEY (whatsapp_connection_id)
      REFERENCES ${table("whatsapp_connections")}(id)
      ON DELETE CASCADE
    `.execute(db);
  }
  await sql`
    DROP INDEX IF EXISTS ${sql.ref(`${schemaName}_whatsapp_labels_label_uidx`)}
  `.execute(db);
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS ${sql.ref(
      `${schemaName}_whatsapp_labels_connection_label_uidx`,
    )}
    ON ${table("whatsapp_labels")} (whatsapp_connection_id, label_id)
    WHERE whatsapp_connection_id IS NOT NULL
  `.execute(db);
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS ${sql.ref(
      `${schemaName}_whatsapp_labels_connection_tag_uidx`,
    )}
    ON ${table("whatsapp_labels")} (whatsapp_connection_id, synced_tag_id)
    WHERE whatsapp_connection_id IS NOT NULL AND synced_tag_id IS NOT NULL
  `.execute(db);

  await sql`
    UPDATE ${table("whatsapp_catalogs")}
    SET name = catalog_id
    WHERE name IS NULL
  `.execute(db);
  await sql`
    ALTER TABLE ${table("whatsapp_catalogs")}
    ALTER COLUMN name SET NOT NULL,
    ADD COLUMN IF NOT EXISTS whatsapp_connection_id UUID,
    ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'USD',
    ADD COLUMN IF NOT EXISTS status catalog_status NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS business_jid VARCHAR(100),
    ADD COLUMN IF NOT EXISTS header_image_url TEXT,
    ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
  `.execute(db);
  await sql`
    UPDATE ${table("whatsapp_catalogs")}
    SET whatsapp_connection_id = (
      SELECT id
      FROM ${table("whatsapp_connections")}
      ORDER BY (status = 'connected') DESC, created_at ASC
      LIMIT 1
    )
    WHERE whatsapp_connection_id IS NULL
  `.execute(db);
  await sql`
    ALTER TABLE ${table("whatsapp_catalogs")}
    DROP CONSTRAINT IF EXISTS ${sql.ref("whatsapp_catalogs_catalog_id_key")}
  `.execute(db);
  if (
    !(await tenantConstraintExists(
      db,
      schemaName,
      "whatsapp_catalogs",
      "whatsapp_catalogs_connection_fk",
    ))
  ) {
    await sql`
      ALTER TABLE ${table("whatsapp_catalogs")}
      ADD CONSTRAINT whatsapp_catalogs_connection_fk
      FOREIGN KEY (whatsapp_connection_id)
      REFERENCES ${table("whatsapp_connections")}(id)
      ON DELETE CASCADE
    `.execute(db);
  }
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS ${sql.ref(
      `${schemaName}_whatsapp_catalogs_connection_catalog_uidx`,
    )}
    ON ${table("whatsapp_catalogs")} (whatsapp_connection_id, catalog_id)
    WHERE whatsapp_connection_id IS NOT NULL
  `.execute(db);
  await sql`
    ALTER TABLE ${table("catalog_products")}
    DROP CONSTRAINT IF EXISTS ${sql.ref("fk_catalog")}
  `.execute(db);
  await sql`
    ALTER TABLE ${table("catalog_products")}
    ALTER COLUMN catalog_id TYPE VARCHAR(100) USING catalog_id::text,
    ADD COLUMN IF NOT EXISTS whatsapp_connection_id UUID,
    ADD COLUMN IF NOT EXISTS image_urls TEXT[],
    ADD COLUMN IF NOT EXISTS sku VARCHAR(100),
    ADD COLUMN IF NOT EXISTS category VARCHAR(255),
    ADD COLUMN IF NOT EXISTS visibility product_visibility NOT NULL DEFAULT 'visible'
  `.execute(db);
  await sql`
    UPDATE ${table("catalog_products")} AS product
    SET
      catalog_id = catalog.catalog_id,
      whatsapp_connection_id = catalog.whatsapp_connection_id
    FROM ${table("whatsapp_catalogs")} AS catalog
    WHERE product.catalog_id = catalog.id::text
  `.execute(db);
  await sql`
    UPDATE ${table("catalog_products")} AS product
    SET whatsapp_connection_id = catalog.whatsapp_connection_id
    FROM ${table("whatsapp_catalogs")} AS catalog
    WHERE product.whatsapp_connection_id IS NULL
      AND product.catalog_id = catalog.catalog_id
  `.execute(db);
  await sql`
    ALTER TABLE ${table("catalog_products")}
    DROP CONSTRAINT IF EXISTS ${sql.ref(
      "catalog_products_product_id_catalog_id_key",
    )}
  `.execute(db);
  if (
    !(await tenantConstraintExists(
      db,
      schemaName,
      "catalog_products",
      "catalog_products_connection_fk",
    ))
  ) {
    await sql`
      ALTER TABLE ${table("catalog_products")}
      ADD CONSTRAINT catalog_products_connection_fk
      FOREIGN KEY (whatsapp_connection_id)
      REFERENCES ${table("whatsapp_connections")}(id)
      ON DELETE CASCADE
    `.execute(db);
  }
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS ${sql.ref(
      `${schemaName}_catalog_products_connection_catalog_product_uidx`,
    )}
    ON ${table("catalog_products")} (
      whatsapp_connection_id,
      catalog_id,
      product_id
    )
    WHERE whatsapp_connection_id IS NOT NULL
  `.execute(db);
  if (
    await tenantColumnExists(db, schemaName, "catalog_products", "image_url")
  ) {
    await sql`
      UPDATE ${table("catalog_products")}
      SET image_urls = ARRAY[image_url]
      WHERE image_urls IS NULL AND image_url IS NOT NULL
    `.execute(db);
  }
  await sql`
    ALTER TABLE ${table("quick_replies")}
    ADD COLUMN IF NOT EXISTS title VARCHAR(255) NOT NULL DEFAULT ''
  `.execute(db);

  await sql`
    ALTER TABLE ${table("conversation_states")}
    ADD COLUMN IF NOT EXISTS read_by_user_id UUID,
    ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_message_preview TEXT,
    ADD COLUMN IF NOT EXISTS unread_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS status conversation_status NOT NULL DEFAULT 'open',
    ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS resolved_by UUID,
    ADD COLUMN IF NOT EXISTS reopened_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reopened_by UUID,
    ADD COLUMN IF NOT EXISTS resolution_notes TEXT
  `.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS ${sql.ref(`${schemaName}_conv_states_status_idx`)}
    ON ${table("conversation_states")} (status)
  `.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS ${sql.ref(`${schemaName}_conv_states_resolved_idx`)}
    ON ${table("conversation_states")} (resolved_at)
  `.execute(db);

  await sql`
    ALTER TABLE ${table("whatsapp_connections")}
    ADD COLUMN IF NOT EXISTS qr_code TEXT,
    ADD COLUMN IF NOT EXISTS qr_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS sync_message_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS sync_conversation_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS ${table("whatsapp_connection_sessions")} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      whatsapp_connection_id UUID NOT NULL
        REFERENCES ${table("whatsapp_connections")}(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN (
          'pending',
          'connecting',
          'connected',
          'disconnected',
          'ended'
        )),
      created_by UUID,
      expected_phone_number VARCHAR(50),
      started_at TIMESTAMPTZ,
      connected_at TIMESTAMPTZ,
      ended_at TIMESTAMPTZ,
      end_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`
    ALTER TABLE ${table("whatsapp_connection_sessions")}
    ADD COLUMN IF NOT EXISTS expected_phone_number VARCHAR(50)
  `.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS ${sql.ref(
      `${schemaName}_wa_sessions_account_idx`,
    )}
    ON ${table("whatsapp_connection_sessions")} (
      whatsapp_connection_id,
      created_at DESC
    )
  `.execute(db);
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS ${sql.ref(
      `${schemaName}_wa_sessions_active_uidx`,
    )}
    ON ${table("whatsapp_connection_sessions")} (whatsapp_connection_id)
    WHERE ended_at IS NULL
  `.execute(db);

  await sql`
    ALTER TABLE ${table("messages")}
    ADD COLUMN IF NOT EXISTS sender_name TEXT,
    ADD COLUMN IF NOT EXISTS sender_avatar_url TEXT
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS ${table("nats_outbox")} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      subject TEXT NOT NULL,
      payload JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'claimed', 'published', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      published_at TIMESTAMPTZ
    )
  `.execute(db);
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS ${sql.ref(
      `${schemaName}_contacts_connection_jid_uidx`,
    )}
    ON ${table("contacts")} (whatsapp_connection_id, jid)
    WHERE whatsapp_connection_id IS NOT NULL AND jid IS NOT NULL
  `.execute(db);
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS ${sql.ref(
      `${schemaName}_whatsapp_connections_phone_uidx`,
    )}
    ON ${table("whatsapp_connections")} (phone_number)
    WHERE phone_number IS NOT NULL
  `.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS ${sql.ref(`${schemaName}_nats_outbox_pending_idx`)}
    ON ${table("nats_outbox")} (status, next_attempt_at, created_at)
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS ${table("scheduled_messages")} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contact_id UUID NOT NULL,
      content TEXT NOT NULL,
      message_type message_type NOT NULL DEFAULT 'text',
      reply_to_message_id UUID,
      scheduled_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'processing', 'sent', 'failed', 'canceled')),
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMPTZ NOT NULL,
      last_error TEXT,
      sent_message_id UUID,
      created_by UUID NOT NULL,
      canceled_by UUID,
      canceled_at TIMESTAMPTZ,
      sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS ${sql.ref(
      `${schemaName}_scheduled_messages_due_idx`,
    )}
    ON ${table("scheduled_messages")} (next_attempt_at)
    WHERE status IN ('scheduled', 'processing')
  `.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS ${sql.ref(
      `${schemaName}_scheduled_messages_contact_idx`,
    )}
    ON ${table("scheduled_messages")} (contact_id, scheduled_at)
  `.execute(db);
}
