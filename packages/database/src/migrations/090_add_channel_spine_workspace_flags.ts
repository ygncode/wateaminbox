import { type Kysely, sql } from "kysely";

/** Add deployment-neutral authority. No row and all defaults mean legacy/off. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE TABLE public.channel_spine_workspace_flags (
    company_id UUID PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
    dual_write_enabled BOOLEAN NOT NULL DEFAULT false,
    dual_write_revision TEXT,
    neutral_reads_enabled BOOLEAN NOT NULL DEFAULT false,
    neutral_read_revision TEXT,
    write_authority TEXT NOT NULL DEFAULT 'legacy' CHECK (write_authority IN ('legacy', 'neutral')),
    write_authority_revision TEXT,
    enabled_providers TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    provider_enable_revision TEXT,
    revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    updated_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (NOT dual_write_enabled OR NULLIF(btrim(dual_write_revision), '') IS NOT NULL),
    CHECK (NOT neutral_reads_enabled OR NULLIF(btrim(neutral_read_revision), '') IS NOT NULL),
    CHECK (write_authority = 'legacy' OR NULLIF(btrim(write_authority_revision), '') IS NOT NULL),
    CHECK (cardinality(enabled_providers) = 0 OR NULLIF(btrim(provider_enable_revision), '') IS NOT NULL),
    CHECK (array_position(enabled_providers, NULL) IS NULL)
  )`.execute(db);
  await sql`CREATE TABLE public.channel_spine_workspace_flag_audit (
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    revision BIGINT NOT NULL,
    changed_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    previous_flags JSONB,
    new_flags JSONB NOT NULL,
    PRIMARY KEY (company_id, revision)
  )`.execute(db);
  await sql`CREATE FUNCTION public.channel_spine_workspace_flags_guard() RETURNS trigger LANGUAGE plpgsql AS $function$
    BEGIN
      IF NEW.company_id <> OLD.company_id THEN RAISE EXCEPTION 'channel spine flag company_id is immutable'; END IF;
      IF NEW.revision <> OLD.revision + 1 THEN RAISE EXCEPTION 'channel spine flag revision must advance by exactly one'; END IF;
      NEW.created_by := OLD.created_by; NEW.created_at := OLD.created_at; NEW.updated_at := now();
      RETURN NEW;
    END $function$`.execute(db);
  await sql`CREATE FUNCTION public.audit_channel_spine_workspace_flags() RETURNS trigger LANGUAGE plpgsql AS $function$
    BEGIN
      INSERT INTO public.channel_spine_workspace_flag_audit (company_id, revision, changed_by, previous_flags, new_flags)
      VALUES (NEW.company_id, NEW.revision, NEW.updated_by, CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END, to_jsonb(NEW));
      RETURN NEW;
    END $function$`.execute(db);
  await sql`CREATE TRIGGER channel_spine_workspace_flags_guard BEFORE UPDATE ON public.channel_spine_workspace_flags FOR EACH ROW EXECUTE FUNCTION public.channel_spine_workspace_flags_guard()`.execute(
    db,
  );
  await sql`CREATE TRIGGER audit_channel_spine_workspace_flags AFTER INSERT OR UPDATE ON public.channel_spine_workspace_flags FOR EACH ROW EXECUTE FUNCTION public.audit_channel_spine_workspace_flags()`.execute(
    db,
  );
  await sql`REVOKE ALL ON public.channel_spine_workspace_flags FROM PUBLIC`.execute(
    db,
  );
  await sql`REVOKE ALL ON public.channel_spine_workspace_flag_audit FROM PUBLIC`.execute(
    db,
  );
  await sql`REVOKE EXECUTE ON FUNCTION public.channel_spine_workspace_flags_guard() FROM PUBLIC`.execute(
    db,
  );
  await sql`REVOKE EXECUTE ON FUNCTION public.audit_channel_spine_workspace_flags() FROM PUBLIC`.execute(
    db,
  );
  await sql
    .raw(
      `DO $block$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wateaminbox_worker_runtime') THEN REVOKE ALL ON public.channel_spine_workspace_flags FROM wateaminbox_worker_runtime; REVOKE ALL ON public.channel_spine_workspace_flag_audit FROM wateaminbox_worker_runtime; REVOKE EXECUTE ON FUNCTION public.channel_spine_workspace_flags_guard() FROM wateaminbox_worker_runtime; REVOKE EXECUTE ON FUNCTION public.audit_channel_spine_workspace_flags() FROM wateaminbox_worker_runtime; END IF; END $block$`,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE public.channel_spine_workspace_flag_audit`.execute(db);
  await sql`DROP TABLE public.channel_spine_workspace_flags`.execute(db);
  await sql`DROP FUNCTION public.audit_channel_spine_workspace_flags()`.execute(
    db,
  );
  await sql`DROP FUNCTION public.channel_spine_workspace_flags_guard()`.execute(
    db,
  );
}
