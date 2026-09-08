import { type Kysely, sql } from "kysely";
import { forEachTenant } from "./migration-helpers.js";

export async function up(db: Kysely<unknown>): Promise<void> {
  await forEachTenant(db, async (schema) => {
    await sql`CREATE TABLE IF NOT EXISTS ${sql.table(`${schema}.conversation_notes`)} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES ${sql.table(`${schema}.conversations`)}(id) ON DELETE CASCADE,
      author_user_id UUID NOT NULL,
      visibility TEXT NOT NULL CHECK (visibility IN ('shared', 'private')),
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (length(trim(content)) > 0)
    )`.execute(db);
    await sql`CREATE INDEX IF NOT EXISTS ${sql.ref(`${schema}_conversation_notes_list_idx`)}
      ON ${sql.table(`${schema}.conversation_notes`)} (conversation_id, created_at DESC, id DESC)`.execute(
      db,
    );
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await forEachTenant(db, async (schema) => {
    await sql`DROP TABLE IF EXISTS ${sql.table(`${schema}.conversation_notes`)}`.execute(
      db,
    );
  });
}
