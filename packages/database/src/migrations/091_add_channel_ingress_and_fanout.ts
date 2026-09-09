import { type Kysely, sql } from "kysely";

const ingressRole = "wateaminbox_channel_ingress";
const workerRole = "wateaminbox_worker_runtime";

/**
 * Add public routing and fanout primitives without enabling any provider.
 * Tenant IDs in these rows are intentionally not foreign-keyed across schemas.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(`
    DO $block$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ingressRole}') THEN
        CREATE ROLE ${ingressRole} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
      END IF;
    END
    $block$
  `)
    .execute(db);

  await sql`CREATE TABLE public.channel_ingress_routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL,
    route_key_hash VARCHAR(64) NOT NULL,
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    channel_account_id UUID NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending'
      CHECK (state IN ('pending', 'active', 'revoked')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ,
    CHECK (route_key_hash ~ '^[0-9a-f]{64}$'),
    CHECK ((state = 'revoked') = (revoked_at IS NOT NULL))
  )`.execute(db);
  await sql`CREATE UNIQUE INDEX channel_ingress_routes_live_uidx
    ON public.channel_ingress_routes (provider, route_key_hash)
    WHERE state <> 'revoked'`.execute(db);
  await sql`CREATE INDEX channel_ingress_routes_account_idx
    ON public.channel_ingress_routes (company_id, channel_account_id)
    WHERE state <> 'revoked'`.execute(db);

  await sql`CREATE TABLE public.channel_message_delivery_outbox (
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    channel_account_id UUID NOT NULL,
    conversation_id UUID NOT NULL,
    message_id UUID NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('realtime', 'push')),
    case_event JSONB,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (company_id, message_id, kind)
  )`.execute(db);
  await sql`CREATE INDEX channel_message_delivery_outbox_due_idx
    ON public.channel_message_delivery_outbox (kind, next_attempt_at, created_at)`.execute(
    db,
  );
  await sql`CREATE INDEX channel_message_delivery_outbox_conversation_idx
    ON public.channel_message_delivery_outbox (company_id, conversation_id, created_at)`.execute(
    db,
  );

  await sql
    .raw(
      `GRANT CONNECT ON DATABASE ${quoteIdentifier(await currentDatabase(db))} TO ${ingressRole}`,
    )
    .execute(db);
  await sql`GRANT USAGE ON SCHEMA public TO wateaminbox_channel_ingress`.execute(
    db,
  );
  await sql`GRANT SELECT, INSERT ON public.channel_ingress_routes TO wateaminbox_channel_ingress`.execute(
    db,
  );
  await sql`GRANT UPDATE (state, updated_at, revoked_at) ON public.channel_ingress_routes TO wateaminbox_channel_ingress`.execute(
    db,
  );
  await sql`REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.channel_ingress_routes FROM wateaminbox_channel_ingress`.execute(
    db,
  );
  await sql`REVOKE ALL ON public.channel_message_delivery_outbox FROM wateaminbox_channel_ingress`.execute(
    db,
  );

  await sql`REVOKE ALL ON public.channel_ingress_routes FROM PUBLIC`.execute(
    db,
  );
  await sql`REVOKE ALL ON public.channel_message_delivery_outbox FROM PUBLIC`.execute(
    db,
  );
  await sql
    .raw(`
    DO $block$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${workerRole}') THEN
        REVOKE ALL ON public.channel_ingress_routes FROM ${workerRole};
        REVOKE ALL ON public.channel_message_delivery_outbox FROM ${workerRole};
      END IF;
    END
    $block$
  `)
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE public.channel_message_delivery_outbox`.execute(db);
  await sql`DROP TABLE public.channel_ingress_routes`.execute(db);
  await sql
    .raw(
      `REVOKE ALL ON DATABASE ${quoteIdentifier(await currentDatabase(db))} FROM ${ingressRole}`,
    )
    .execute(db);
  await sql.raw(`DROP ROLE IF EXISTS ${ingressRole}`).execute(db);
}

async function currentDatabase(db: Kysely<unknown>): Promise<string> {
  const result = await sql<{
    name: string;
  }>`SELECT current_database() AS name`.execute(db);
  const name = result.rows[0]?.name;
  if (!name) throw new Error("current database is unavailable");
  return name;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
