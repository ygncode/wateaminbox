import { type Kysely, sql } from "kysely";

/** Shared by migration 087 and new-tenant reconciliation. No historical backfill. */
export async function ensureConnectionAlertSchema<DB>(
  db: Kysely<DB>,
  schema: string,
): Promise<void> {
  const table = (name: string) => sql.table(`${schema}.${name}`);
  const installed = await sql<{ installed: boolean }>`
    SELECT EXISTS (
      SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ${schema} AND c.relname = 'whatsapp_connections'
        AND t.tgname = 'connection_email_alerts_changed' AND NOT t.tgisinternal
    ) AS installed
  `.execute(db);
  if (installed.rows[0]?.installed) return;

  await sql`
    CREATE TABLE IF NOT EXISTS ${table("connection_email_alerts")} (
      id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
      connection_id UUID NOT NULL REFERENCES ${table("whatsapp_connections")}(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('disconnected', 'logged_out')),
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      next_attempt_at TIMESTAMPTZ NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      sent_at TIMESTAMPTZ,
      PRIMARY KEY (connection_id, user_id)
    )
  `.execute(db);
  // A trigger covers worker events, crashes and recovery atomically, including
  // older writers. Duplicate disconnects do not reset the grace period. Pending
  // during reconnect retains the incident; connected/archive cancels it.
  await sql`
    CREATE OR REPLACE FUNCTION ${sql.ref(`${schema}.queue_connection_email_alert`)}()
    RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE alert_kind TEXT;
    BEGIN
      IF NEW.archived_at IS NOT NULL OR NEW.status = 'connected' THEN
        DELETE FROM ${table("connection_email_alerts")} WHERE connection_id = NEW.id;
        RETURN NEW;
      END IF;
      IF NEW.logged_out_at IS NOT NULL AND OLD.logged_out_at IS NULL THEN
        alert_kind := 'logged_out';
      ELSIF OLD.status = 'connected' AND NEW.status <> 'connected' THEN
        alert_kind := 'disconnected';
      ELSE
        RETURN NEW;
      END IF;
      INSERT INTO ${table("connection_email_alerts")}
        (connection_id, user_id, kind, occurred_at, next_attempt_at)
      SELECT NEW.id, m.user_id, alert_kind, now(),
        CASE WHEN alert_kind = 'logged_out' THEN now() ELSE now() + interval '5 minutes' END
      FROM public.company_members m
      JOIN public.companies c ON c.id = m.company_id
      JOIN public.users u ON u.id = m.user_id
      WHERE c.schema_name = TG_TABLE_SCHEMA AND c.status = 'active'
        AND m.role IN ('owner', 'admin') AND u.email_verified_at IS NOT NULL
      ON CONFLICT (connection_id, user_id) DO UPDATE SET
        id = gen_random_uuid(), kind = EXCLUDED.kind,
        occurred_at = EXCLUDED.occurred_at, next_attempt_at = EXCLUDED.next_attempt_at,
        attempts = 0, sent_at = NULL
      WHERE connection_email_alerts.kind = 'disconnected' AND EXCLUDED.kind = 'logged_out';
      RETURN NEW;
    END;
    $fn$
  `.execute(db);
  await sql`
    CREATE TRIGGER connection_email_alerts_changed
    AFTER UPDATE OF status, logged_out_at, archived_at ON ${table("whatsapp_connections")}
    FOR EACH ROW EXECUTE FUNCTION ${sql.ref(`${schema}.queue_connection_email_alert`)}()
  `.execute(db);
}
