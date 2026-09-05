import { type Kysely, sql } from "kysely";
import { executeOnAllTenants } from "./migration-helpers.js";

/**
 * Workspace-level first-contact auto-reply configuration and the metadata used
 * to distinguish its queued messages from manually scheduled messages.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    const settings = sql.table(`${schemaName}.auto_reply_settings`);
    const scheduled = sql.table(`${schemaName}.scheduled_messages`);
    const quickReplies = sql.table(`${schemaName}.quick_replies`);

    await sql`
      CREATE TABLE IF NOT EXISTS ${settings} (
        id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        enabled BOOLEAN NOT NULL DEFAULT false,
        quick_reply_id UUID REFERENCES ${quickReplies}(id) ON DELETE SET NULL,
        delay_minutes INTEGER NOT NULL DEFAULT 5
          CHECK (delay_minutes BETWEEN 1 AND 1440),
        send_mode TEXT NOT NULL DEFAULT 'always'
          CHECK (send_mode IN ('always', 'outside_business_hours')),
        updated_by UUID NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CHECK (NOT enabled OR quick_reply_id IS NOT NULL)
      )
    `.execute(db);

    await sql`
      ALTER TABLE ${scheduled}
      ADD COLUMN IF NOT EXISTS auto_reply_trigger_message_id UUID,
      ADD COLUMN IF NOT EXISTS auto_reply_quick_reply_id UUID
    `.execute(db);

    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS ${sql.ref(
        `${schemaName}_scheduled_messages_auto_reply_contact_uidx`,
      )}
      ON ${scheduled} (contact_id)
      WHERE auto_reply_trigger_message_id IS NOT NULL
    `.execute(db);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    await sql`
      DROP INDEX IF EXISTS ${sql.ref(
        `${schemaName}.${schemaName}_scheduled_messages_auto_reply_contact_uidx`,
      )}
    `.execute(db);
    await sql`
      ALTER TABLE ${sql.table(`${schemaName}.scheduled_messages`)}
      DROP COLUMN IF EXISTS auto_reply_quick_reply_id,
      DROP COLUMN IF EXISTS auto_reply_trigger_message_id
    `.execute(db);
    await sql`
      DROP TABLE IF EXISTS ${sql.table(`${schemaName}.auto_reply_settings`)}
    `.execute(db);
  });
}
