import { expect, test } from "bun:test";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { SYSTEM_SUPPRESSION_ACTOR } from "./channel-spine-schema.js";
import { backfillLegacyBlockSuppressions } from "./migrations/115_add_contact_suppression_core.js";

const integration = process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

/**
 * Migration 115 on a tenant shaped like production before it: the original
 * spine `contact_suppressions` (no expiry, no scope check, no unique slot)
 * and WhatsApp contacts carrying `is_blocked`.
 */
integration(
  "migration 115 hardens contact_suppressions and backfills one block per blocked person",
  async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
      throw new Error("Local test database required");
    }
    const database = new Kysely<unknown>({
      dialect: new PostgresDialect({
        pool: new Pool({ connectionString: url.toString(), max: 1 }),
      }),
    });
    const schemaName = `tenant_cs_${crypto.randomUUID().replaceAll("-", "")}`;
    const schema = sql.id(schemaName);
    const blocked = crypto.randomUUID();
    const allowed = crypto.randomUUID();
    const blockedGroup = crypto.randomUUID();
    try {
      await sql`CREATE SCHEMA ${schema}`.execute(database);
      await sql`CREATE TABLE ${schema}.contacts (
        id UUID PRIMARY KEY,
        is_blocked BOOLEAN NOT NULL DEFAULT false,
        is_group BOOLEAN NOT NULL DEFAULT false
      )`.execute(database);
      await sql`CREATE TABLE ${schema}.contact_suppressions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contact_id UUID NOT NULL REFERENCES ${schema}.contacts(id) ON DELETE CASCADE,
        scope TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_by UUID NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        revoked_at TIMESTAMPTZ
      )`.execute(database);
      await sql`INSERT INTO ${schema}.contacts (id, is_blocked, is_group) VALUES
        (${blocked}, true, false),
        (${allowed}, false, false),
        (${blockedGroup}, true, true)`.execute(database);

      // The schema half of 114, exactly as ensureChannelSpineTenantSchema runs it.
      await sql`ALTER TABLE ${schema}.contact_suppressions
        ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS revoked_by UUID`.execute(database);
      await sql`CREATE UNIQUE INDEX ${sql.id(`${schemaName}_csup_active_uidx`)}
        ON ${schema}.contact_suppressions (contact_id, scope)
        WHERE revoked_at IS NULL`.execute(database);

      expect(await backfillLegacyBlockSuppressions(database, schemaName)).toBe(
        1,
      );
      expect(await backfillLegacyBlockSuppressions(database, schemaName)).toBe(
        0,
      );
      const rows = await sql<{
        contact_id: string;
        scope: string;
        reason: string;
        created_by: string;
      }>`SELECT contact_id, scope, reason, created_by
         FROM ${schema}.contact_suppressions WHERE revoked_at IS NULL`.execute(
        database,
      );
      expect(rows.rows).toEqual([
        {
          contact_id: blocked,
          scope: "block",
          reason: "legacy:is_blocked",
          created_by: SYSTEM_SUPPRESSION_ACTOR,
        },
      ]);

      // A revoked block frees the slot; a contact still marked blocked gets a
      // fresh one on the next run.
      await sql`UPDATE ${schema}.contact_suppressions SET revoked_at = now()`.execute(
        database,
      );
      expect(await backfillLegacyBlockSuppressions(database, schemaName)).toBe(
        1,
      );
    } finally {
      await sql`DROP SCHEMA IF EXISTS ${schema} CASCADE`.execute(database);
      await database.destroy();
    }
  },
);
