import { type Kysely, sql } from "kysely";

/**
 * Migration 106 and new-tenant reconciliation share this additive upgrade.
 *
 * The provider's own identifier for an accepted send is the only handle an
 * operator has when auditing a delivery after the fact, so it is recorded
 * alongside `sent_at` instead of being discarded with the mail result.
 */
export async function ensureConnectionAlertMessageIdSchema<DB>(
  db: Kysely<DB>,
  schema: string,
): Promise<void> {
  const table = sql.table(`${schema}.connection_email_alerts`);
  await sql`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS message_id TEXT`.execute(
    db,
  );
  // Supersedes the body migration 088 installed, in the same way 088 rearmed
  // the escalation path 087 established. The trigger itself remains 088's:
  // only the function it calls changes, so the replace is unconditional and
  // idempotent rather than guarded on the column that may already exist.
  await sql`
    CREATE OR REPLACE FUNCTION ${sql.ref(`${schema}.reset_connection_notification`)}()
    RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NEW.id IS DISTINCT FROM OLD.id THEN
        NEW.notification_created_at := NULL;
        -- A rotated id is a fresh alert awaiting its own send. Keeping the
        -- previous id would attribute the earlier mail to this incident.
        NEW.message_id := NULL;
      END IF;
      RETURN NEW;
    END;
    $fn$
  `.execute(db);
}
