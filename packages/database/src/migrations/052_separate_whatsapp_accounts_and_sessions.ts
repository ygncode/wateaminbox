import { type Kysely, sql } from "kysely";
import { executeOnAllTenants } from "./migration-helpers.js";

/**
 * Separate the durable inbox/account identity from replaceable WhatsApp
 * pairing sessions.
 *
 * `whatsapp_connections` remains the stable account record referenced by
 * contacts and messages. Workers and whatsmeow credentials are keyed by
 * `whatsapp_connection_sessions.id`.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    const connections = sql.table(`${schemaName}.whatsapp_connections`);
    const sessions = sql.table(`${schemaName}.whatsapp_connection_sessions`);

    await sql`
      ALTER TABLE ${connections}
      ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ
    `.execute(db);

    await sql`
      CREATE TABLE IF NOT EXISTS ${sessions} (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        whatsapp_connection_id UUID NOT NULL,
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
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT whatsapp_connection_sessions_account_fk
          FOREIGN KEY (whatsapp_connection_id)
          REFERENCES ${connections}(id)
          ON DELETE CASCADE
      )
    `.execute(db);
    await sql`
      ALTER TABLE ${sessions}
      ADD COLUMN IF NOT EXISTS expected_phone_number VARCHAR(50)
    `.execute(db);

    // Existing workers and whatsmeow stores are keyed by the old connection
    // UUID. Reusing that UUID for the backfilled session preserves them.
    await sql`
      INSERT INTO ${sessions} (
        id,
        whatsapp_connection_id,
        status,
        created_by,
        expected_phone_number,
        started_at,
        connected_at,
        ended_at,
        end_reason,
        created_at,
        updated_at
      )
      SELECT
        connection.id,
        connection.id,
        CASE
          WHEN connection.status = 'connected' THEN 'connected'
          WHEN connection.status = 'pending' THEN 'pending'
          ELSE 'disconnected'
        END,
        connection.connected_by,
        connection.phone_number,
        connection.created_at,
        connection.connected_at,
        NULL,
        NULL,
        connection.created_at,
        connection.updated_at
      FROM ${connections} AS connection
      ON CONFLICT (id) DO NOTHING
    `.execute(db);

    await sql`
      CREATE INDEX IF NOT EXISTS ${sql.ref(
        `${schemaName}_wa_sessions_account_idx`,
      )}
      ON ${sessions} (whatsapp_connection_id, created_at DESC)
    `.execute(db);

    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS ${sql.ref(
        `${schemaName}_wa_sessions_active_uidx`,
      )}
      ON ${sessions} (whatsapp_connection_id)
      WHERE ended_at IS NULL
    `.execute(db);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    await sql`
      DROP TABLE IF EXISTS ${sql.table(
        `${schemaName}.whatsapp_connection_sessions`,
      )}
    `.execute(db);
    await sql`
      ALTER TABLE ${sql.table(`${schemaName}.whatsapp_connections`)}
      DROP COLUMN IF EXISTS archived_at
    `.execute(db);
  });
}
