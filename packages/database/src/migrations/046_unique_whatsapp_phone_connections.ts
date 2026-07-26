import { type Kysely, sql } from "kysely";
import { executeOnAllTenants } from "./migration-helpers.js";

/** Ensure one WhatsApp phone identity maps to one connection per workspace. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    const table = sql.raw(`"${schemaName}".whatsapp_connections`);

    // WhatsApp normally emits digits, but normalize older values before adding
    // the invariant so formatting differences cannot bypass it.
    await sql`
      UPDATE ${table}
      SET phone_number = NULLIF(regexp_replace(phone_number, '[^0-9]', '', 'g'), '')
      WHERE phone_number IS NOT NULL
    `.execute(db);

    // QR codes are pairing secrets and must never survive a completed or
    // cancelled setup from older application versions.
    await sql`
      UPDATE ${table}
      SET qr_code = NULL, qr_expires_at = NULL
      WHERE status <> 'pending'
    `.execute(db);

    // Preserve the strongest/most recent record and detach identity metadata
    // from historical duplicates rather than deleting rows with related data.
    await sql`
      WITH ranked AS (
        SELECT
          id,
          row_number() OVER (
            PARTITION BY phone_number
            ORDER BY
              CASE WHEN status = 'connected' THEN 0 ELSE 1 END,
              connected_at DESC NULLS LAST,
              created_at DESC
          ) AS duplicate_rank
        FROM ${table}
        WHERE phone_number IS NOT NULL
      )
      UPDATE ${table} AS connections
      SET
        phone_number = NULL,
        jid = NULL,
        status = 'disconnected',
        qr_code = NULL,
        qr_expires_at = NULL
      FROM ranked
      WHERE connections.id = ranked.id
        AND ranked.duplicate_rank > 1
    `.execute(db);

    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS ${sql.ref(
        `${schemaName}_whatsapp_connections_phone_uidx`,
      )}
      ON ${table} (phone_number)
      WHERE phone_number IS NOT NULL
    `.execute(db);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    await sql`DROP INDEX IF EXISTS ${sql.raw(
      `"${schemaName}"."${schemaName}_whatsapp_connections_phone_uidx"`,
    )}`.execute(db);
  });
}
