import { type Kysely, sql } from "kysely";
import { installOutboxDispatchTrigger } from "../dispatch-schema.js";
import { getTenantSchemas } from "./migration-helpers.js";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE TABLE public.outbox_dispatch_ready (
    company_id UUID PRIMARY KEY,
    generation BIGINT NOT NULL DEFAULT 0,
    due_at TIMESTAMPTZ,
    claim_token UUID,
    claimed_until TIMESTAMPTZ
  )`.execute(db);
  await sql`CREATE INDEX outbox_dispatch_due_idx ON public.outbox_dispatch_ready (due_at, company_id)
    WHERE due_at IS NOT NULL`.execute(db);
  await sql`CREATE TABLE public.outbox_dispatch_recovery (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    cursor UUID,
    next_run_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`.execute(db);
  await sql`INSERT INTO public.outbox_dispatch_recovery (id) VALUES (1)`.execute(
    db,
  );
  // UUID comes from the actual trigger schema, never the command payload.
  // Invoker security and explicit qualification preserve the existing DB boundary.
  await sql`CREATE FUNCTION public.mark_outbox_dispatch_ready() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog AS $$
    DECLARE tenant_id UUID;
    BEGIN
      IF TG_TABLE_SCHEMA !~ '^tenant_[0-9a-f]{8}_[0-9a-f]{4}_[0-9a-f]{4}_[0-9a-f]{4}_[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'Invalid outbox schema';
      END IF;
      IF TG_OP = 'DELETE' AND OLD.status NOT IN ('pending', 'claimed') THEN RETURN NULL; END IF;
      IF TG_OP = 'INSERT' AND NEW.status NOT IN ('pending', 'claimed') THEN RETURN NULL; END IF;
      tenant_id := replace(substring(TG_TABLE_SCHEMA from 8), '_', '-')::uuid;
      INSERT INTO public.outbox_dispatch_ready (company_id, generation, due_at)
      VALUES (tenant_id, 1, statement_timestamp())
      ON CONFLICT (company_id) DO UPDATE SET
        generation = public.outbox_dispatch_ready.generation + 1,
        due_at = LEAST(public.outbox_dispatch_ready.due_at, EXCLUDED.due_at);
      RETURN NULL;
    END $$`.execute(db);
  for (const schema of await getTenantSchemas(db)) {
    await installOutboxDispatchTrigger(db, schema);
    await sql`INSERT INTO public.outbox_dispatch_ready (company_id, due_at)
      SELECT ${schema.slice(7).replaceAll("_", "-")}::uuid, min(next_attempt_at)
      FROM ${sql.table(`${schema}.nats_outbox`)} WHERE status IN ('pending','claimed')
      HAVING count(*) > 0 ON CONFLICT DO NOTHING`.execute(db);
  }
  // IDs only: the dispatcher reads current data, so stale payloads cannot
  // resurrect deleted messages. No customer message content is duplicated.
  await sql`CREATE TABLE public.message_search_outbox (
    company_id UUID NOT NULL,
    message_id UUID NOT NULL,
    connection_id UUID NOT NULL,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (company_id, message_id)
  )`.execute(db);
  await sql`CREATE INDEX message_search_outbox_due_idx
    ON public.message_search_outbox (next_attempt_at, created_at)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const schema of await getTenantSchemas(db)) {
    await sql`DROP TRIGGER IF EXISTS outbox_dispatch_ready ON ${sql.table(`${schema}.nats_outbox`)}`.execute(
      db,
    );
  }
  await sql`DROP FUNCTION public.mark_outbox_dispatch_ready()`.execute(db);
  await sql`DROP TABLE public.message_search_outbox`.execute(db);
  await sql`DROP TABLE public.outbox_dispatch_recovery`.execute(db);
  await sql`DROP TABLE public.outbox_dispatch_ready`.execute(db);
}
