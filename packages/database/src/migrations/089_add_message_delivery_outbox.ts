import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE TABLE public.message_delivery_outbox (
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    connection_id UUID NOT NULL,
    message_id UUID NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('realtime', 'push')),
    case_event JSONB,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (company_id, message_id, kind)
  )`.execute(db);
  await sql`CREATE INDEX message_delivery_outbox_due_idx
    ON public.message_delivery_outbox (kind, next_attempt_at, created_at)`.execute(
    db,
  );
}
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE public.message_delivery_outbox`.execute(db);
}
