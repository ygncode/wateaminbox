import { type Kysely, sql } from "kysely";
import { forEachTenant } from "./migration-helpers.js";

/**
 * Let an outbound intent act on a message that already has a send intent.
 *
 * `outbound_message_intents.message_id` was UNIQUE, which encodes "one intent
 * per message". That holds for sends, but an action - a reaction, an edit, a
 * delete - targets a message that may already own its send intent, so the
 * constraint made those operations unrepresentable for a message this
 * workspace sent.
 *
 * The one-send-per-message guarantee is preserved by a partial unique index
 * covering only non-action operations. Actions stay bounded by the existing
 * UNIQUE (channel_account_id, operation, idempotency_key), which is what makes
 * a retried reaction idempotent.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await forEachTenant(db, async (schema) => {
    await sql`SET lock_timeout = '5s'`.execute(db);
    const table = sql.table(`${schema}.outbound_message_intents`);
    // Postgres names a column-level UNIQUE after the table and column.
    await sql`ALTER TABLE ${table}
      DROP CONSTRAINT IF EXISTS ${sql.ref("outbound_message_intents_message_id_key")}`.execute(
      db,
    );
    // Suffix kept short: `tenant_<uuid>_` is 43 characters, so a longer name
    // would be silently truncated at PostgreSQL's 63-character limit and no
    // longer match what the schema reconciler looks for.
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS ${sql.ref(`${schema}_omi_send_msg_uidx`)}
      ON ${table} (message_id)
      WHERE message_id IS NOT NULL AND operation NOT LIKE 'action:%'`.execute(
      db,
    );
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await forEachTenant(db, async (schema) => {
    const table = sql.table(`${schema}.outbound_message_intents`);
    await sql`DROP INDEX IF EXISTS ${sql.ref(`${schema}.${schema}_omi_send_msg_uidx`)}`.execute(
      db,
    );
    // Restoring the column UNIQUE is only possible when no action intent
    // shares a message with a send intent; forward-only in production.
    await sql`ALTER TABLE ${table}
      ADD CONSTRAINT ${sql.ref("outbound_message_intents_message_id_key")}
      UNIQUE (message_id)`.execute(db);
  });
}
