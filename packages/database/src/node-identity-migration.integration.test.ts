import { describe, expect, test } from "bun:test";
import { sql } from "kysely";
import { createDatabase } from "./client.js";
import { down, up } from "./migrations/077_add_worker_registry_node_id.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

describe("worker registry node identity migration 077", () => {
  integrationTest(
    "adds a nullable owner column so pre-migration rows await adoption",
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

          // Existing rows must surface as ownerless so the first orchestrator
          // to start adopts them through its NULL-predicate compare-and-swap.
          const migrated = await sql<{ node_id: string | null }>`
            SELECT node_id FROM worker_registry
          `.execute(connection);
          expect(migrated.rows).toHaveLength(1);
          expect(migrated.rows[0]?.node_id).toBeNull();

          // The adoption CAS claims only ownerless rows.
          const adopted = await sql`
            UPDATE worker_registry SET node_id = 'node-1' WHERE node_id IS NULL
          `.execute(connection);
          expect(Number(adopted.numAffectedRows)).toBe(1);
          const contested = await sql`
            UPDATE worker_registry SET node_id = 'node-2' WHERE node_id IS NULL
          `.execute(connection);
          expect(Number(contested.numAffectedRows)).toBe(0);

          await down(connection);
          const columns = await sql<{ column_name: string }>`
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = ${schema} AND table_name = 'worker_registry'
          `.execute(connection);
          expect(
            columns.rows.map((row) => row.column_name),
          ).not.toContain("node_id");
        });
      } finally {
        await sql
          .raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
          .execute(database);
        await database.destroy();
      }
    },
  );
});
