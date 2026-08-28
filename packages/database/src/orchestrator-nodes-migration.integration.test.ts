import { describe, expect, test } from "bun:test";
import { sql } from "kysely";
import { createDatabase } from "./client.js";
import { down, up } from "./migrations/078_add_orchestrator_nodes.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

describe("orchestrator nodes migration 078", () => {
  integrationTest(
    "creates the lease table backing registration, renewal, and takeover",
    async () => {
      const database = createDatabase(process.env.DATABASE_URL || "");
      const schema = `migration_${crypto.randomUUID().replaceAll("-", "_")}`;
      try {
        await sql.raw(`CREATE SCHEMA "${schema}"`).execute(database);
        await database.connection().execute(async (connection) => {
          await sql.raw(`SET search_path TO "${schema}"`).execute(connection);

          await up(connection);

          // Registration refuses a node identity whose lease is still live —
          // the shared-state form of the per-node stop-first constraint.
          await sql`
            INSERT INTO orchestrator_nodes (node_id, lease_expires_at)
            VALUES ('node-1', now() + interval '1 minute')
          `.execute(connection);
          const refused = await sql`
            INSERT INTO orchestrator_nodes (node_id, lease_expires_at)
            VALUES ('node-1', now() + interval '1 minute')
            ON CONFLICT (node_id) DO UPDATE SET
              lease_expires_at = EXCLUDED.lease_expires_at
            WHERE orchestrator_nodes.lease_expires_at <= now()
          `.execute(connection);
          expect(Number(refused.numAffectedRows)).toBe(0);

          // An expired lease admits the replacement instance.
          await sql`
            UPDATE orchestrator_nodes SET lease_expires_at = now()
          `.execute(connection);
          const admitted = await sql`
            INSERT INTO orchestrator_nodes (node_id, lease_expires_at)
            VALUES ('node-1', now() + interval '1 minute')
            ON CONFLICT (node_id) DO UPDATE SET
              lease_expires_at = EXCLUDED.lease_expires_at
            WHERE orchestrator_nodes.lease_expires_at <= now()
          `.execute(connection);
          expect(Number(admitted.numAffectedRows)).toBe(1);

          await down(connection);
          const tables = await sql<{ table_name: string }>`
            SELECT table_name FROM information_schema.tables
            WHERE table_schema = ${schema}
          `.execute(connection);
          expect(
            tables.rows.map((row) => row.table_name),
          ).not.toContain("orchestrator_nodes");
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
