import { type Kysely, sql } from "kysely";

/** Migration 088 and new tenants share this additive upgrade to the alert queue. */
export async function ensureConnectionSystemNotificationSchema<DB>(
  db: Kysely<DB>,
  schema: string,
): Promise<void> {
  const table = sql.table(`${schema}.connection_email_alerts`);
  const state = await sql<{ column_exists: boolean; trigger_exists: boolean }>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_schema = ${schema}
        AND table_name = 'connection_email_alerts' AND column_name = 'notification_created_at'
    ) AS column_exists, EXISTS (
      SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ${schema} AND c.relname = 'connection_email_alerts'
        AND t.tgname = 'connection_notification_reset' AND NOT t.tgisinternal
    ) AS trigger_exists
  `.execute(db);
  if (!state.rows[0]?.column_exists) {
    await sql`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS notification_created_at TIMESTAMPTZ`.execute(
      db,
    );
  }
  if (state.rows[0]?.trigger_exists) return;
  // Migration 087 rotates the alert id when a temporary outage escalates to a
  // logout. Keep its historical function untouched, but rearm this new channel.
  await sql`
    CREATE OR REPLACE FUNCTION ${sql.ref(`${schema}.reset_connection_notification`)}()
    RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NEW.id IS DISTINCT FROM OLD.id THEN NEW.notification_created_at := NULL; END IF;
      RETURN NEW;
    END;
    $fn$
  `.execute(db);
  await sql`
    CREATE TRIGGER connection_notification_reset BEFORE UPDATE OF id ON ${table}
    FOR EACH ROW EXECUTE FUNCTION ${sql.ref(`${schema}.reset_connection_notification`)}()
  `.execute(db);
}
