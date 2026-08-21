import { describe, expect, test } from "bun:test";
import { sql } from "kysely";
import { createDatabase } from "./client.js";
import { down, up } from "./migrations/070_harden_worker_lifecycle.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

describe("worker lifecycle migration 070", () => {
  integrationTest(
    "backfills generations and accepts every durable desired state",
    async () => {
      const database = createDatabase(process.env.DATABASE_URL || "");
      const schema = `migration_${crypto.randomUUID().replaceAll("-", "_")}`;
      try {
        await sql.raw(`CREATE SCHEMA "${schema}"`).execute(database);
        await database.connection().execute(async (connection) => {
          await sql.raw(`SET search_path TO "${schema}"`).execute(connection);
          await sql`
            CREATE TABLE worker_registry (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              connection_id uuid NOT NULL UNIQUE,
              company_id uuid NOT NULL,
              tenant_schema varchar(100) NOT NULL,
              pid integer NOT NULL,
              status varchar(20) NOT NULL DEFAULT 'starting',
              started_at timestamptz NOT NULL DEFAULT now(),
              last_heartbeat timestamptz NOT NULL DEFAULT now(),
              restart_count integer NOT NULL DEFAULT 0,
              database_url text NOT NULL
            )
          `.execute(connection);
          await sql`
            INSERT INTO worker_registry (
              connection_id, company_id, tenant_schema, pid, database_url
            ) VALUES (
              ${crypto.randomUUID()}::uuid,
              ${crypto.randomUUID()}::uuid,
              'tenant_company',
              42,
              ''
            )
          `.execute(connection);

          await up(connection);

          const migrated = await sql<{
            desired_state: string;
            launch_id: string;
          }>`
            SELECT desired_state, launch_id::text AS launch_id
            FROM worker_registry
          `.execute(connection);
          expect(migrated.rows).toHaveLength(1);
          expect(migrated.rows[0]?.desired_state).toBe("running");
          expect(migrated.rows[0]?.launch_id).toBeTruthy();

          for (const state of ["running", "stopped", "unlinking"]) {
            await sql`UPDATE worker_registry SET desired_state = ${state}`.execute(
              connection,
            );
          }
          await expect(
            sql`UPDATE worker_registry SET desired_state = 'invalid'`.execute(
              connection,
            ),
          ).rejects.toThrow();

          await down(connection);
          const columns = await sql<{ column_name: string }>`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = ${schema}
              AND table_name = 'worker_registry'
              AND column_name IN ('launch_id', 'desired_state')
          `.execute(connection);
          expect(columns.rows).toHaveLength(0);
        });
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
