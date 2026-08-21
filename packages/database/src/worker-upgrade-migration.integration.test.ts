import { describe, expect, test } from "bun:test";
import { sql } from "kysely";
import { createDatabase } from "./client.js";
import { down, up } from "./migrations/071_add_worker_upgrade_batches.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

describe("worker upgrade migration 071", () => {
  integrationTest(
    "is additive, enforces one active batch, and retains scoped snapshots",
    async () => {
      const database = createDatabase(process.env.DATABASE_URL || "");
      const schema = `migration_${crypto.randomUUID().replaceAll("-", "_")}`;
      try {
        await sql.raw(`CREATE SCHEMA "${schema}"`).execute(database);
        await database.connection().execute(async (connection) => {
          await sql.raw(`SET search_path TO "${schema}"`).execute(connection);
          await sql`
            CREATE TABLE worker_registry (
              connection_id UUID PRIMARY KEY,
              company_id UUID NOT NULL,
              tenant_schema VARCHAR(100) NOT NULL,
              launch_id UUID NOT NULL,
              status VARCHAR(20) NOT NULL DEFAULT 'connected'
            )
          `.execute(connection);

          const connectionID = crypto.randomUUID();
          const companyID = crypto.randomUUID();
          const sourceGeneration = crypto.randomUUID();
          await sql`
            INSERT INTO worker_registry (
              connection_id, company_id, tenant_schema, launch_id
            ) VALUES (
              ${connectionID}::uuid, ${companyID}::uuid,
              'tenant_company', ${sourceGeneration}::uuid
            )
          `.execute(connection);

          await up(connection);

          // Old orchestrator statements neither know nor supply artifact fields.
          await sql`
            UPDATE worker_registry SET status = 'recovering'
            WHERE connection_id = ${connectionID}::uuid
          `.execute(connection);
          const legacyConnectionID = crypto.randomUUID();
          await sql`
            INSERT INTO worker_registry (
              connection_id, company_id, tenant_schema, launch_id, status
            ) VALUES (
              ${legacyConnectionID}::uuid, ${companyID}::uuid,
              'tenant_company', ${crypto.randomUUID()}::uuid, 'connected'
            )
          `.execute(connection);
          const legacyArtifact = await sql<{
            artifact_version: string;
            artifact_sha256: string;
            worker_uid: number;
            worker_gid: number;
          }>`
            SELECT artifact_version, artifact_sha256, worker_uid, worker_gid
            FROM worker_registry
            WHERE connection_id = ${legacyConnectionID}::uuid
          `.execute(connection);
          expect(legacyArtifact.rows[0]?.artifact_version).toBe("embedded");
          expect(legacyArtifact.rows[0]?.artifact_sha256).toBe("");
          expect(legacyArtifact.rows[0]?.worker_uid).toBeGreaterThanOrEqual(100000);
          expect(legacyArtifact.rows[0]?.worker_gid).toBe(
            legacyArtifact.rows[0]?.worker_uid,
          );
          const migratedIdentity = await sql<{
            connection_id: string;
            worker_uid: number;
            worker_gid: number;
          }>`
            SELECT connection_id::text, worker_uid, worker_gid
            FROM worker_registry ORDER BY connection_id
          `.execute(connection);
          expect(new Set(migratedIdentity.rows.map((row) => row.worker_uid)).size).toBe(2);
          expect(
            migratedIdentity.rows.every(
              (row) => row.worker_uid === row.worker_gid,
            ),
          ).toBe(true);
          const previousUID = migratedIdentity.rows.find(
            (row) => row.connection_id === connectionID,
          )?.worker_uid;
          const replacementIdentity = await sql<{
            worker_uid: number;
            worker_gid: number;
          }>`
            INSERT INTO worker_registry (
              connection_id, company_id, tenant_schema, launch_id, status
            ) VALUES (
              ${connectionID}::uuid, ${companyID}::uuid,
              'tenant_company', ${crypto.randomUUID()}::uuid, 'connecting'
            )
            ON CONFLICT (connection_id) DO UPDATE
              SET launch_id = EXCLUDED.launch_id,
                  worker_uid = EXCLUDED.worker_uid
            RETURNING worker_uid, worker_gid
          `.execute(connection);
          expect(replacementIdentity.rows[0]?.worker_uid).not.toBe(previousUID);
          expect(replacementIdentity.rows[0]?.worker_gid).toBe(
            replacementIdentity.rows[0]?.worker_uid,
          );
          await expect(
            sql`
              UPDATE worker_registry
              SET artifact_version = '../escape', artifact_sha256 = 'bad'
              WHERE connection_id = ${legacyConnectionID}::uuid
            `.execute(connection),
          ).rejects.toThrow();

          const first = await sql<{ id: string }>`
            INSERT INTO worker_upgrade_batches (
              target_artifact_version, target_artifact_sha256
            ) VALUES ('v2', ${"b".repeat(64)})
            RETURNING id::text AS id
          `.execute(connection);
          const batchID = first.rows[0]?.id;
          expect(batchID).toBeTruthy();

          await expect(
            sql`
            INSERT INTO worker_upgrade_batches (
              target_artifact_version, target_artifact_sha256
            ) VALUES ('v3', ${"c".repeat(64)})
          `.execute(connection),
          ).rejects.toThrow();

          await sql`
            INSERT INTO worker_upgrade_items (
              batch_id, position, company_id, tenant_schema, connection_id,
              source_generation, source_artifact_version,
              source_artifact_sha256
            ) VALUES (
              ${batchID}::uuid, 0, ${companyID}::uuid, 'tenant_company',
              ${connectionID}::uuid, ${sourceGeneration}::uuid,
              'v1', ${"a".repeat(64)}
            )
          `.execute(connection);

          for (const phase of [
            "stop",
            "launch",
            "verify",
            "rollback",
            "recovery",
            "canceled",
            "halted",
          ]) {
            await sql`
              UPDATE worker_upgrade_items SET phase = ${phase}
              WHERE batch_id = ${batchID}::uuid
            `.execute(connection);
          }
          await expect(
            sql`
            UPDATE worker_upgrade_items SET phase = 'unknown'
            WHERE batch_id = ${batchID}::uuid
          `.execute(connection),
          ).rejects.toThrow();
          await expect(
            sql`
              UPDATE worker_upgrade_items SET completed_at = now()
              WHERE batch_id = ${batchID}::uuid
            `.execute(connection),
          ).rejects.toThrow();
          await expect(
            sql`
              UPDATE worker_upgrade_items SET result = 'ambiguous'
              WHERE batch_id = ${batchID}::uuid
            `.execute(connection),
          ).rejects.toThrow();

          await sql`
            UPDATE worker_upgrade_items
            SET phase = 'verify', result = 'target_complete', completed_at = now()
            WHERE batch_id = ${batchID}::uuid
          `.execute(connection);
          await sql`
            UPDATE worker_upgrade_batches
            SET phase = 'verify', result = 'completed', completed_at = now()
            WHERE id = ${batchID}::uuid
          `.execute(connection);
          await sql`
            INSERT INTO worker_upgrade_batches (
              target_artifact_version, target_artifact_sha256
            ) VALUES ('v3', ${"c".repeat(64)})
          `.execute(connection);

          await down(connection);
          const oldRows = await sql<{ status: string }>`
            SELECT status FROM worker_registry
            WHERE connection_id = ${connectionID}::uuid
          `.execute(connection);
          expect(oldRows.rows[0]?.status).toBe("recovering");
          const removed = await sql<{ count: number }>`
            SELECT COUNT(*)::integer AS count
            FROM information_schema.columns
            WHERE table_schema = ${schema}
              AND table_name = 'worker_registry'
              AND column_name IN (
                'artifact_version', 'artifact_sha256', 'worker_uid', 'worker_gid'
              )
          `.execute(connection);
          expect(removed.rows[0]?.count).toBe(0);
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
