import { describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { createDatabase } from "./client.js";
import { up } from "./migrations/044_fix_notifications_and_add_push_subscriptions.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

describe("notification migration 044", () => {
  integrationTest(
    "converts UUID mute arrays without data loss",
    async () => {
      const database = createDatabase(process.env.DATABASE_URL || "");
      const schema = `tenant_${crypto.randomUUID().replaceAll("-", "_")}`;
      const legacyMute = crypto.randomUUID();
      try {
        await sql.raw(`CREATE SCHEMA "${schema}"`).execute(database);
        await sql
          .raw(`CREATE TABLE "${schema}".notification_preferences (
        id UUID PRIMARY KEY, user_id UUID NOT NULL UNIQUE,
        muted_contacts UUID[] DEFAULT ARRAY[]::UUID[],
        sound_enabled BOOLEAN DEFAULT true, sound_choice TEXT DEFAULT 'default',
        quiet_hours_start TIME, quiet_hours_end TIME,
        created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
      )`)
          .execute(database);
        await sql
          .raw(`INSERT INTO "${schema}".notification_preferences
        (id, user_id, muted_contacts) VALUES
        ('${crypto.randomUUID()}', '${crypto.randomUUID()}', ARRAY['${legacyMute}'::UUID])`)
          .execute(database);

        await up(database as unknown as Kysely<unknown>);
        const result = await sql<{ muted_contacts: string[] }>`
        SELECT muted_contacts
        FROM ${sql.raw(`"${schema}".notification_preferences`)}
        LIMIT 1
      `.execute(database);
        expect(result.rows[0]?.muted_contacts).toEqual([legacyMute]);
      } finally {
        await sql
          .raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
          .execute(database);
        await database.destroy();
      }
    },
    30_000,
  );
});
