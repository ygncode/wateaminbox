import { type Kysely, sql } from "kysely";

/** Add an independently controlled, legacy-safe normalization shadow mode. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE public.channel_spine_workspace_flags
    ADD COLUMN shadow_normalization_enabled BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN shadow_normalization_revision TEXT`.execute(db);
  await sql`ALTER TABLE public.channel_spine_workspace_flags
    ADD CONSTRAINT channel_spine_shadow_revision_check
    CHECK (
      NOT shadow_normalization_enabled
      OR NULLIF(btrim(shadow_normalization_revision), '') IS NOT NULL
    ) NOT VALID`.execute(db);
  await sql`ALTER TABLE public.channel_spine_workspace_flags
    VALIDATE CONSTRAINT channel_spine_shadow_revision_check`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE public.channel_spine_workspace_flags
    DROP CONSTRAINT channel_spine_shadow_revision_check,
    DROP COLUMN shadow_normalization_revision,
    DROP COLUMN shadow_normalization_enabled`.execute(db);
}
