import { describe, expect, test } from "bun:test";
import { sql } from "kysely";
import { createDatabase } from "./client.js";
import {
  applyQuickRepliesShortcutUnique,
  removeQuickRepliesShortcutUnique,
} from "./migrations/103_add_quick_replies_shortcut_unique.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

interface UniqueIndex {
  name: string;
  unique: boolean;
  columns: string[];
}

async function shortcutIndexes(
  database: ReturnType<typeof createDatabase>,
  schema: string,
): Promise<UniqueIndex[]> {
  const result = await sql<{
    indexname: string;
    is_unique: boolean;
    columns: string[];
  }>`
    SELECT
      i.relname AS indexname,
      ix.indisunique AS is_unique,
      array_agg(a.attname::text ORDER BY k.ord) AS columns
    FROM pg_index ix
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
    WHERE n.nspname = ${schema} AND t.relname = 'quick_replies'
    GROUP BY i.relname, ix.indisunique
  `.execute(database);
  return result.rows.map((row) => ({
    name: row.indexname,
    unique: row.is_unique,
    columns: row.columns,
  }));
}

/**
 * Build a pre-090 tenant by hand: `quick_replies` with the legacy PLAIN
 * (non-unique) index, plus the `auto_reply_settings` and `scheduled_messages`
 * tables that reference it. This is exactly the shape `up` migrates;
 * `reconcileTenantSchema` is intentionally NOT used because it would install
 * the UNIQUE index itself and mask the migration under test.
 */
async function buildPreMigrationTenant(
  database: ReturnType<typeof createDatabase>,
  schema: string,
): Promise<void> {
  const legacyIndex = `${schema}_quick_replies_shortcut_idx`.slice(0, 63);
  await sql.raw(`CREATE SCHEMA "${schema}"`).execute(database);
  await sql
    .raw(`
    CREATE TABLE "${schema}".quick_replies (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      shortcut VARCHAR(50) NOT NULL,
      title VARCHAR(255) NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      created_by UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
    .execute(database);
  await sql
    .raw(`
    CREATE INDEX "${legacyIndex}" ON "${schema}".quick_replies (shortcut)
  `)
    .execute(database);
  await sql
    .raw(`
    CREATE TABLE "${schema}".auto_reply_settings (
      id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      enabled BOOLEAN NOT NULL DEFAULT false,
      quick_reply_id UUID REFERENCES "${schema}".quick_replies(id) ON DELETE SET NULL,
      delay_minutes INTEGER NOT NULL DEFAULT 5 CHECK (delay_minutes BETWEEN 1 AND 1440),
      send_mode TEXT NOT NULL DEFAULT 'always' CHECK (send_mode IN ('always', 'outside_business_hours')),
      updated_by UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (NOT enabled OR quick_reply_id IS NOT NULL)
    )
  `)
    .execute(database);
  await sql
    .raw(`
    CREATE TABLE "${schema}".scheduled_messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      auto_reply_quick_reply_id UUID,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
    .execute(database);
}

async function insertReply(
  database: ReturnType<typeof createDatabase>,
  schema: string,
  shortcut: string,
  createdAt: Date,
): Promise<string> {
  const id = crypto.randomUUID();
  await sql`
    INSERT INTO ${sql.table(`${schema}.quick_replies`)}
      (id, shortcut, title, content, created_by, created_at)
    VALUES (${id}, ${shortcut}, ${shortcut}, ${shortcut}, ${crypto.randomUUID()}, ${createdAt})
  `.execute(database);
  return id;
}

describe("quick_replies shortcut uniqueness migration 090", () => {
  integrationTest(
    "collapses duplicates, re-points references, and installs the UNIQUE index",
    async () => {
      const database = createDatabase(process.env.DATABASE_URL || "");
      const schema = `tenant_${crypto.randomUUID().replaceAll("-", "_")}`;
      try {
        await buildPreMigrationTenant(database, schema);
        const old = new Date("2026-01-01T00:00:00Z");
        const newer = new Date("2026-02-01T00:00:00Z");

        // Duplicate group "hi": auto_reply_settings points at the OLDER row so
        // the survivor rule must keep it (not the newest); a queued reply
        // references the NEWER, doomed row so its reference has to be re-pointed.
        const hiOlder = await insertReply(database, schema, "hi", old);
        const hiNewer = await insertReply(database, schema, "hi", newer);
        await sql`
          INSERT INTO ${sql.table(`${schema}.auto_reply_settings`)}
            (id, enabled, quick_reply_id, updated_by)
          VALUES (1, true, ${hiOlder}, ${crypto.randomUUID()})
        `.execute(database);
        await sql`
          INSERT INTO ${sql.table(`${schema}.scheduled_messages`)}
            (auto_reply_quick_reply_id)
          VALUES (${hiNewer})
        `.execute(database);

        // Duplicate group "yo": no references, so the newest row survives.
        const yoOlder = await insertReply(database, schema, "yo", old);
        const yoNewer = await insertReply(database, schema, "yo", newer);

        await applyQuickRepliesShortcutUnique(database, schema);

        const replies = await sql<{ id: string; shortcut: string }>`
          SELECT id, shortcut FROM ${sql.table(`${schema}.quick_replies`)}
          ORDER BY shortcut
        `.execute(database);
        expect(replies.rows).toEqual([
          { id: hiOlder, shortcut: "hi" },
          { id: yoNewer, shortcut: "yo" },
        ]);
        expect(yoOlder).not.toBe(yoNewer);

        // The auto-reply rule survives intact: still enabled and still pointing
        // at a live row; ON DELETE SET NULL did not silently disable it.
        const ars = await sql<{
          enabled: boolean;
          quick_reply_id: string | null;
        }>`SELECT enabled, quick_reply_id FROM ${sql.table(
          `${schema}.auto_reply_settings`,
        )}`.execute(database);
        expect(ars.rows[0]?.enabled).toBe(true);
        expect(ars.rows[0]?.quick_reply_id).toBe(hiOlder);

        // The queued reply was re-pointed from the doomed newer duplicate to
        // the survivor, so it will still send the configured template.
        const sm = await sql<{ ref: string | null }>`
          SELECT auto_reply_quick_reply_id AS ref
          FROM ${sql.table(`${schema}.scheduled_messages`)}
        `.execute(database);
        expect(sm.rows[0]?.ref).toBe(hiOlder);

        const indexes = await shortcutIndexes(database, schema);
        const unique = indexes.find(
          (idx) =>
            idx.unique &&
            idx.columns.length === 1 &&
            idx.columns[0] === "shortcut",
        );
        expect(unique?.name).toBe(`${schema}_qr_shortcut_uidx`);
        const legacyName = `${schema}_quick_replies_shortcut_idx`.slice(0, 63);
        expect(indexes.map((idx) => idx.name)).not.toContain(legacyName);

        // The DB now rejects a duplicate shortcut at the source of truth.
        await expect(
          sql`
            INSERT INTO ${sql.table(`${schema}.quick_replies`)}
              (shortcut, title, content, created_by)
            VALUES ('hi', 'x', 'x', ${crypto.randomUUID()})
          `.execute(database),
        ).rejects.toMatchObject({ code: "23505" });

        // Re-running the per-schema migration is a no-op (idempotent).
        await applyQuickRepliesShortcutUnique(database, schema);
        const stillThere = await sql<{ count: number }>`
          SELECT count(*)::int AS count FROM ${sql.table(`${schema}.quick_replies`)}
        `.execute(database);
        expect(stillThere.rows[0]?.count).toBe(2);
      } finally {
        await sql
          .raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
          .execute(database);
        await database.destroy();
      }
    },
    120_000,
  );

  integrationTest(
    "down reverses the unique index to a non-unique one",
    async () => {
      const database = createDatabase(process.env.DATABASE_URL || "");
      const schema = `tenant_${crypto.randomUUID().replaceAll("-", "_")}`;
      try {
        await buildPreMigrationTenant(database, schema);
        await insertReply(database, schema, "solo", new Date());

        await applyQuickRepliesShortcutUnique(database, schema);
        expect(
          (await shortcutIndexes(database, schema)).find(
            (idx) =>
              idx.unique &&
              idx.columns.length === 1 &&
              idx.columns[0] === "shortcut",
          ),
        ).toBeDefined();

        await removeQuickRepliesShortcutUnique(database, schema);
        const shortcutIdx = await shortcutIndexes(database, schema);
        expect(
          shortcutIdx.find(
            (idx) =>
              idx.unique &&
              idx.columns.length === 1 &&
              idx.columns[0] === "shortcut",
          ),
        ).toBeUndefined();
        expect(
          shortcutIdx.find(
            (idx) =>
              !idx.unique &&
              idx.columns.length === 1 &&
              idx.columns[0] === "shortcut",
          ),
        ).toBeDefined();

        // Without the UNIQUE constraint a duplicate can be inserted again.
        await sql`
          INSERT INTO ${sql.table(`${schema}.quick_replies`)}
            (shortcut, title, content, created_by)
          VALUES ('solo', 'dup', 'dup', ${crypto.randomUUID()})
        `.execute(database);
      } finally {
        await sql
          .raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
          .execute(database);
        await database.destroy();
      }
    },
    120_000,
  );
});
