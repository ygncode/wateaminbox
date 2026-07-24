import { sql, type Kysely } from 'kysely'

/**
 * Adds a durable transactional command outbox and makes a WhatsApp contact's
 * connection part of its identity. The same remote JID may legitimately exist
 * on several connected WhatsApp accounts.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    DO $$
    DECLARE
      schema_record RECORD;
      index_name TEXT;
    BEGIN
      CREATE TEMP TABLE IF NOT EXISTS contact_merge_map (
        duplicate_id UUID PRIMARY KEY,
        canonical_id UUID NOT NULL
      ) ON COMMIT DROP;

      FOR schema_record IN
        SELECT schema_name
        FROM information_schema.schemata
        WHERE schema_name LIKE 'tenant_%'
      LOOP
        TRUNCATE contact_merge_map;

        EXECUTE format($query$
          INSERT INTO contact_merge_map (duplicate_id, canonical_id)
          SELECT id, canonical_id
          FROM (
            SELECT
              id,
              first_value(id) OVER (
                PARTITION BY whatsapp_connection_id, jid
                ORDER BY created_at, id
              ) AS canonical_id,
              row_number() OVER (
                PARTITION BY whatsapp_connection_id, jid
                ORDER BY created_at, id
              ) AS row_number
            FROM %I.contacts
            WHERE whatsapp_connection_id IS NOT NULL AND jid IS NOT NULL
          ) ranked
          WHERE row_number > 1
        $query$, schema_record.schema_name);

        -- Move references before removing duplicate contacts. Contact tags and
        -- conversation state need conflict-safe handling because they are
        -- unique per contact.
        EXECUTE format($query$
          DELETE FROM %I.contact_tags duplicate_tag
          USING contact_merge_map mapping
          WHERE duplicate_tag.contact_id = mapping.duplicate_id
            AND EXISTS (
              SELECT 1 FROM %I.contact_tags canonical_tag
              WHERE canonical_tag.contact_id = mapping.canonical_id
                AND canonical_tag.tag_id = duplicate_tag.tag_id
            )
        $query$, schema_record.schema_name, schema_record.schema_name);

        EXECUTE format('UPDATE %I.contact_tags value SET contact_id = mapping.canonical_id FROM contact_merge_map mapping WHERE value.contact_id = mapping.duplicate_id', schema_record.schema_name);
        EXECUTE format('UPDATE %I.messages value SET contact_id = mapping.canonical_id FROM contact_merge_map mapping WHERE value.contact_id = mapping.duplicate_id', schema_record.schema_name);
        EXECUTE format('UPDATE %I.contact_assignments value SET contact_id = mapping.canonical_id FROM contact_merge_map mapping WHERE value.contact_id = mapping.duplicate_id', schema_record.schema_name);
        EXECUTE format('UPDATE %I.contact_notes_private value SET contact_id = mapping.canonical_id FROM contact_merge_map mapping WHERE value.contact_id = mapping.duplicate_id', schema_record.schema_name);
        EXECUTE format('UPDATE %I.contact_notes_shared value SET contact_id = mapping.canonical_id FROM contact_merge_map mapping WHERE value.contact_id = mapping.duplicate_id', schema_record.schema_name);
        EXECUTE format('UPDATE %I.groups value SET contact_id = mapping.canonical_id FROM contact_merge_map mapping WHERE value.contact_id = mapping.duplicate_id', schema_record.schema_name);

        EXECUTE format($query$
          DELETE FROM %I.conversation_states duplicate_state
          USING contact_merge_map mapping
          WHERE duplicate_state.contact_id = mapping.duplicate_id
            AND EXISTS (
              SELECT 1 FROM %I.conversation_states canonical_state
              WHERE canonical_state.contact_id = mapping.canonical_id
            )
        $query$, schema_record.schema_name, schema_record.schema_name);
        EXECUTE format('UPDATE %I.conversation_states value SET contact_id = mapping.canonical_id FROM contact_merge_map mapping WHERE value.contact_id = mapping.duplicate_id', schema_record.schema_name);

        EXECUTE format('DELETE FROM %I.contacts value USING contact_merge_map mapping WHERE value.id = mapping.duplicate_id', schema_record.schema_name);

        index_name := replace(schema_record.schema_name, '-', '_') || '_contacts_connection_jid_uidx';
        EXECUTE format(
          'CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I.contacts (whatsapp_connection_id, jid) WHERE whatsapp_connection_id IS NOT NULL AND jid IS NOT NULL',
          index_name,
          schema_record.schema_name
        );

        EXECUTE format($query$
          CREATE TABLE IF NOT EXISTS %I.nats_outbox (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            subject TEXT NOT NULL,
            payload JSONB NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'published', 'failed')),
            attempts INTEGER NOT NULL DEFAULT 0,
            next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_error TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            published_at TIMESTAMPTZ
          )
        $query$, schema_record.schema_name);

        EXECUTE format(
          'CREATE INDEX IF NOT EXISTS %I ON %I.nats_outbox (status, next_attempt_at, created_at)',
          replace(schema_record.schema_name, '-', '_') || '_nats_outbox_pending_idx',
          schema_record.schema_name
        );
      END LOOP;
    END $$
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DO $$
    DECLARE schema_record RECORD;
    BEGIN
      FOR schema_record IN
        SELECT schema_name
        FROM information_schema.schemata
        WHERE schema_name LIKE 'tenant_%'
      LOOP
        EXECUTE format('DROP TABLE IF EXISTS %I.nats_outbox', schema_record.schema_name);
        EXECUTE format(
          'DROP INDEX IF EXISTS %I.%I',
          schema_record.schema_name,
          replace(schema_record.schema_name, '-', '_') || '_contacts_connection_jid_uidx'
        );
      END LOOP;
    END $$
  `.execute(db)
}
