import type { Kysely } from "kysely";
import { sql } from "kysely";
import { executeOnAllTenants } from "./migration-helpers.js";

/**
 * Search moves to PostgreSQL only (Meilisearch is being removed).
 *
 * Two things make the Postgres path good enough to be the only path:
 *
 * 1. Trigram indexes. The `'english'` text-search configuration cannot split
 *    Thai, Burmese or CJK text into words, so for those scripts (and for
 *    phone-number fragments) `ILIKE '%term%'` is the match that finds
 *    anything. pg_trgm GIN indexes make that substring match indexed and
 *    language-agnostic. Contacts are small and are indexed here; the hot
 *    `messages` table gets its trigram index through the concurrent index
 *    runner (`channel-spine-index-runner.ts`) so no SHARE lock is taken while
 *    workers are writing.
 *
 * 2. A trigger keeps `messages.search_vector` populated. Only the legacy
 *    inbound path ever set it; channel-spine inserts, outbound sends and edits
 *    left it NULL, so those rows matched only via ILIKE and ranked 0. The
 *    trigger derives it from `content` on every insert/update.
 *
 * pg_trgm is a trusted extension, so the database owner can create it on
 * managed PostgreSQL without superuser, exactly like pgcrypto in 001.
 */

export const CONTACT_TRIGRAM_INDEXES: ReadonlyArray<{
  suffix: string;
  column: string;
}> = [
  { suffix: "ct_push_trgm", column: "push_name" },
  { suffix: "ct_custom_trgm", column: "custom_name" },
  { suffix: "ct_phone_trgm", column: "phone_number" },
  { suffix: "ct_user_trgm", column: "username" },
  { suffix: "ct_notes_trgm", column: "notes_shared" },
];

/** Index names must stay under PostgreSQL's 63-byte identifier limit. */
export const contactTrigramIndexName = (
  schemaName: string,
  suffix: string,
): string => `${schemaName}_${suffix}`;

export const SEARCH_VECTOR_TRIGGER = "messages_search_vector";
export const SEARCH_VECTOR_FUNCTION = "messages_search_vector_update";

export function searchVectorTriggerSql(schemaName: string): string {
  const fn = `"${schemaName}"."${SEARCH_VECTOR_FUNCTION}"`;
  const table = `"${schemaName}"."messages"`;
  return `
    CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      NEW.search_vector := to_tsvector('english', COALESCE(NEW.content, ''));
      RETURN NEW;
    END
    $$;
    DROP TRIGGER IF EXISTS ${SEARCH_VECTOR_TRIGGER} ON ${table};
    CREATE TRIGGER ${SEARCH_VECTOR_TRIGGER}
      BEFORE INSERT OR UPDATE OF content ON ${table}
      FOR EACH ROW EXECUTE FUNCTION ${fn}();
  `;
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public`.execute(
    db,
  );
  await executeOnAllTenants(db, async (schemaName) => {
    for (const { suffix, column } of CONTACT_TRIGRAM_INDEXES) {
      await sql`
        CREATE INDEX IF NOT EXISTS ${sql.ref(contactTrigramIndexName(schemaName, suffix))}
        ON ${sql.raw(`"${schemaName}"."contacts"`)}
        USING gin (${sql.ref(column)} public.gin_trgm_ops)
      `.execute(db);
    }
    await sql.raw(searchVectorTriggerSql(schemaName)).execute(db);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    // Schema-qualified: the migrator's search_path is not the tenant schema.
    await sql
      .raw(
        `DROP TRIGGER IF EXISTS ${SEARCH_VECTOR_TRIGGER} ON "${schemaName}"."messages"`,
      )
      .execute(db);
    await sql
      .raw(`DROP FUNCTION IF EXISTS "${schemaName}"."${SEARCH_VECTOR_FUNCTION}"()`)
      .execute(db);
    for (const { suffix } of CONTACT_TRIGRAM_INDEXES) {
      await sql
        .raw(
          `DROP INDEX IF EXISTS "${schemaName}"."${contactTrigramIndexName(schemaName, suffix)}"`,
        )
        .execute(db);
    }
  });
  // The extension stays installed: other objects may come to depend on it.
}
