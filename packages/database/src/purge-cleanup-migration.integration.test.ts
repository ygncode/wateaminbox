import { describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { createDatabase } from "./client.js";
import { applyConnectionPurgeRecovery } from "./migrations/066_add_connection_purge_recovery.js";
import { applyMediaDeletionIntent } from "./migrations/067_add_media_deletion_intent.js";
import { reconcileTenantSchema } from "./tenant-schema.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

async function columnsOf(
  database: Kysely<unknown>,
  schema: string,
  table: string,
): Promise<string[]> {
  const result = await sql<{ column_name: string }>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = ${schema} AND table_name = ${table}
    ORDER BY column_name
  `.execute(database);
  return result.rows.map((row) => row.column_name);
}

/**
 * A tenant created before 066 has neither the retained broadcast counters nor
 * the cleanup queue. Both have to arrive through the migration for existing
 * workspaces and through `reconcileTenantSchema` for new ones, or a purge
 * would fail to record the external work it must still finish.
 */
describe("connection purge recovery migration 066", () => {
  integrationTest(
    "reconciliation restores the queue for a tenant that lost it",
    async () => {
      const database = createDatabase(process.env.DATABASE_URL || "");
      const schema = `tenant_${crypto.randomUUID().replaceAll("-", "_")}`;
      try {
        await sql
          .raw(`SELECT setup_tenant_schema('${schema}')`)
          .execute(database);
        await reconcileTenantSchema(database, schema);
        expect(
          await columnsOf(database, schema, "purge_cleanup_items"),
        ).toHaveLength(10);

        // Simulate drift - a tenant restored from a pre-066 dump.
        await sql
          .raw(`DROP TABLE "${schema}".purge_cleanup_items`)
          .execute(database);
        await sql
          .raw(`ALTER TABLE "${schema}".bulk_jobs
            DROP COLUMN purged_sent,
            DROP COLUMN purged_failed,
            DROP COLUMN purged_canceled,
            DROP COLUMN purged_skipped`)
          .execute(database);

        await reconcileTenantSchema(database, schema);

        expect(
          await columnsOf(database, schema, "purge_cleanup_items"),
        ).toHaveLength(10);
        expect(await columnsOf(database, schema, "bulk_jobs")).toContain(
          "purged_skipped",
        );
        const dueIndex = await sql<{ indexname: string }>`
          SELECT indexname FROM pg_indexes
          WHERE schemaname = ${schema} AND tablename = 'purge_cleanup_items'
        `.execute(database);
        expect(dueIndex.rows.map((row) => row.indexname)).toContain(
          `${schema}_pci_due_idx`,
        );

        // A new tenant must get the same connection-ownership constraints the
        // migration gives existing ones, or purged rows could be recreated
        // behind a connection that no longer exists.
        const constraints = await sql<{ conname: string }>`
          SELECT c.conname
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname = ${schema} AND c.contype = 'f'
        `.execute(database);
        const names = constraints.rows.map((row) => row.conname);
        for (const constraint of [
          "contacts_connection_fk",
          "messages_connection_fk",
          "status_updates_connection_fk",
          "bulk_connection_budgets_connection_fk",
        ]) {
          expect(names).toContain(constraint);
        }

        // One row per (connection, kind, reference): re-running a purge, or a
        // second capture of the same object, must not queue duplicate work.
        const connectionId = crypto.randomUUID();
        await sql
          .raw(`INSERT INTO "${schema}".whatsapp_connections (id, status)
            VALUES ('${connectionId}', 'connected')`)
          .execute(database);
        const insert = async () =>
          sql
            .raw(`INSERT INTO "${schema}".purge_cleanup_items
              (connection_id, kind, reference)
              VALUES ('${connectionId}', 'media', 's3://bucket/key')`)
            .execute(database);
        await insert();
        await expect(insert()).rejects.toThrow();

        // Only the three kinds the processor knows how to drain are storable.
        await expect(
          sql
            .raw(`INSERT INTO "${schema}".purge_cleanup_items
              (connection_id, kind, reference)
              VALUES ('${connectionId}', 'unsupported', 'x')`)
            .execute(database),
        ).rejects.toThrow();

        // Connection ownership is enforced in the database itself, so a worker
        // event can no longer leave a row behind a deleted connection.
        await sql
          .raw(`INSERT INTO "${schema}".messages
            (whatsapp_connection_id, message_id, from_me, message_type, timestamp)
            VALUES ('${connectionId}', 'WA-FK-1', false, 'text', now())`)
          .execute(database);
        await expect(
          sql
            .raw(`INSERT INTO "${schema}".messages
              (whatsapp_connection_id, message_id, from_me, message_type, timestamp)
              VALUES ('${crypto.randomUUID()}', 'WA-FK-2', false, 'text', now())`)
            .execute(database),
        ).rejects.toThrow();
        await sql
          .raw(`DELETE FROM "${schema}".whatsapp_connections
            WHERE id = '${connectionId}'`)
          .execute(database);
        const survivors = await sql<{ count: string }>`
          SELECT count(*) AS count FROM ${sql.table(`${schema}.messages`)}
        `.execute(database);
        expect(survivors.rows[0]?.count).toBe("0");
      } finally {
        await sql
          .raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
          .execute(database);
        await database.destroy();
      }
    },
    120_000,
  );

  /**
   * Direct coverage of the migration DDL itself, against pre-066 schemas built
   * by hand - not of `reconcileTenantSchema`, which is the new-tenant path.
   *
   * Two schemas are migrated to prove the per-schema step is what `up` fans
   * out. `up`'s own `executeOnAllTenants` wrapper walks every `tenant_%`
   * schema in the database, so invoking it here would mutate unrelated test
   * schemas and fail on any partially-built one; that thin wrapper remains
   * uncovered by design.
   */
  integrationTest(
    "migrates a pre-066 tenant's own tables, for each schema it is given",
    async () => {
      const database = createDatabase(process.env.DATABASE_URL || "");
      const schemas = [
        `tenant_${crypto.randomUUID().replaceAll("-", "_")}`,
        `tenant_${crypto.randomUUID().replaceAll("-", "_")}`,
      ];
      try {
        for (const schema of schemas) {
          await sql.raw(`CREATE SCHEMA "${schema}"`).execute(database);
          await sql
            .raw(`CREATE TABLE "${schema}".whatsapp_connections (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid()
            )`)
            .execute(database);
          for (const table of ["contacts", "messages", "status_updates"]) {
            await sql
              .raw(`CREATE TABLE "${schema}".${table} (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                whatsapp_connection_id UUID
              )`)
              .execute(database);
          }
          await sql
            .raw(`CREATE TABLE "${schema}".bulk_connection_budgets (
              whatsapp_connection_id UUID PRIMARY KEY
            )`)
            .execute(database);
          await sql
            .raw(`CREATE TABLE "${schema}".bulk_jobs (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              name TEXT NOT NULL
            )`)
            .execute(database);

          expect(await columnsOf(database, schema, "bulk_jobs")).not.toContain(
            "purged_sent",
          );
        }

        for (const schema of schemas) {
          await applyConnectionPurgeRecovery(database, schema);
          await applyMediaDeletionIntent(database, schema);
          // Idempotent: a re-run over an already-migrated schema is a no-op.
          await applyConnectionPurgeRecovery(database, schema);
          await applyMediaDeletionIntent(database, schema);
        }

        for (const schema of schemas) {
          // 9 from 066, plus `media_key` from 067.
          expect(
            await columnsOf(database, schema, "purge_cleanup_items"),
          ).toEqual([
            "attempts",
            "connection_id",
            "created_at",
            "id",
            "kind",
            "last_error",
            "media_key",
            "next_attempt_at",
            "reference",
            "updated_at",
          ]);
          expect(await columnsOf(database, schema, "bulk_jobs")).toContain(
            "purged_skipped",
          );
          const constraints = await sql<{ conname: string }>`
            SELECT c.conname FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = ${schema} AND c.contype = 'f'
          `.execute(database);
          expect(constraints.rows.map((row) => row.conname)).toContain(
            "messages_connection_fk",
          );
        }
      } finally {
        for (const schema of schemas) {
          await sql
            .raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
            .execute(database);
        }
        await database.destroy();
      }
    },
    120_000,
  );
});
