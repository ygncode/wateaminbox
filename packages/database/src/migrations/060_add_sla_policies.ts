import { type Kysely, sql } from "kysely";

/**
 * Versioned, immutable company SLA response-target policies.
 *
 * Each row is one policy version: a global target (minutes), an IANA
 * timezone, a weekly open-hours schedule, and manual date exceptions.
 * Policies are never updated in place - editing the SLA inserts a new row
 * with `effective_from = now()`. Analytics resolves the policy in effect
 * for a given episode by picking the row with the greatest `effective_from`
 * that is `<= ` the episode's inbound timestamp, so later edits never
 * change how already-recorded (or already-open) episodes are measured.
 *
 * A default 60-minute, UTC, 24/7-open policy is backfilled for every
 * existing company with `effective_from` pinned to a sentinel far in the
 * past (`1970-01-01`), so it resolves for any historical episode -
 * including imported message history that may predate the company's own
 * `created_at` in this system.
 */

const DEFAULT_WEEKLY_SCHEDULE = Array.from({ length: 7 }, (_, weekday) => ({
  weekday,
  open: true,
  intervals: [{ start: "00:00", end: "24:00" }],
}));

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS public.sla_policies (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
      target_minutes INTEGER NOT NULL CHECK (target_minutes BETWEEN 1 AND 1440),
      timezone TEXT NOT NULL,
      weekly_schedule JSONB NOT NULL,
      exceptions JSONB NOT NULL DEFAULT '[]'::jsonb,
      effective_from TIMESTAMPTZ NOT NULL,
      created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_sla_policies_company_effective
    ON public.sla_policies (company_id, effective_from DESC)
  `.execute(db);

  // Backfill: one default policy per existing company that doesn't already
  // have one (idempotent re-run safety), pinned to a sentinel start so it
  // resolves for any historical episode regardless of import history.
  await sql`
    INSERT INTO public.sla_policies
      (company_id, target_minutes, timezone, weekly_schedule, exceptions, effective_from, created_by)
    SELECT
      c.id,
      60,
      'UTC',
      ${JSON.stringify(DEFAULT_WEEKLY_SCHEDULE)}::jsonb,
      '[]'::jsonb,
      TIMESTAMPTZ '1970-01-01T00:00:00Z',
      NULL
    FROM public.companies c
    WHERE NOT EXISTS (
      SELECT 1 FROM public.sla_policies sp WHERE sp.company_id = c.id
    )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS public.sla_policies`.execute(db);
}
