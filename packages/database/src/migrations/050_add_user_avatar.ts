import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS avatar_key VARCHAR(512)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE public.users
    DROP COLUMN IF EXISTS avatar_key
  `.execute(db);
}
