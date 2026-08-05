import { describe, expect, test } from "bun:test";
import {
  db,
  legacyIdentifier,
  reconcileTenantIndexNames,
  TENANT_INDEX_TARGETS,
  targetIdentifier,
} from "@wateaminbox/database";
import { sql } from "kysely";
import {
  createTenantSchema,
  dropTenantSchema,
  getSchemaName,
} from "./tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

/** Index/constraint names present on a table, with their shape. */
async function indexesOn(
  schemaName: string,
  table: string,
): Promise<Array<{ name: string; unique: boolean; columns: string[] }>> {
  const result = await sql<{
    index_name: string;
    is_unique: boolean;
    columns: string[];
  }>`
    SELECT
      i.relname AS index_name,
      ix.indisunique AS is_unique,
      array_agg(a.attname::text ORDER BY k.ord) AS columns
    FROM pg_index ix
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
    WHERE n.nspname = ${schemaName} AND t.relname = ${table}
    GROUP BY i.relname, ix.indisunique
  `.execute(db);
  return result.rows.map((row) => ({
    name: row.index_name,
    unique: row.is_unique,
    columns: row.columns,
  }));
}

async function indexNames(schemaName: string): Promise<Set<string>> {
  const result = await sql<{ indexname: string }>`
    SELECT indexname FROM pg_indexes WHERE schemaname = ${schemaName}
  `.execute(db);
  return new Set(result.rows.map((row) => row.indexname));
}

/**
 * PostgreSQL silently truncates identifiers at 63 bytes, and a tenant schema
 * name eats 43 of them. Twenty historical index names overflowed; three
 * families truncated into each other, which turned `CREATE INDEX IF NOT
 * EXISTS` into a no-op and left four indexes - two of them UNIQUE - absent
 * from every tenant.
 *
 * These tests run against a real PostgreSQL because the failure mode is a
 * property of the server, not of the source.
 */
describe("tenant index name normalization", () => {
  integrationTest(
    "a newly created tenant has every canonical index and no truncated leftovers",
    async () => {
      const companyId = crypto.randomUUID();
      const schemaName = getSchemaName(companyId);

      try {
        await createTenantSchema(companyId);
        const present = await indexNames(schemaName);

        const missing = TENANT_INDEX_TARGETS.filter(
          (target) => !present.has(targetIdentifier(schemaName, target)),
        ).map((target) => target.suffix);
        expect(missing).toEqual([]);

        // Nothing should still be sitting under a truncated legacy name.
        const leftovers = TENANT_INDEX_TARGETS.filter((target) =>
          present.has(legacyIdentifier(schemaName, target)),
        ).map((target) => target.suffix);
        expect(leftovers).toEqual([]);

        // Every name the server actually stored fits, so none was truncated.
        for (const name of present) expect(name.length).toBeLessThanOrEqual(63);
      } finally {
        await dropTenantSchema(companyId);
      }
    },
  );

  integrationTest(
    "the four silently-missing indexes exist, with the right shape",
    async () => {
      const companyId = crypto.randomUUID();
      const schemaName = getSchemaName(companyId);

      try {
        await createTenantSchema(companyId);

        const connections = await indexesOn(schemaName, "whatsapp_connections");
        const phone = connections.find(
          (index) => index.name === `${schemaName}_wconn_phone_uidx`,
        );
        expect(phone).toBeDefined();
        expect(phone?.unique).toBe(true);
        expect(phone?.columns).toEqual(["phone_number"]);
        // Its truncation sibling must still be there too - the bug was that
        // only one of the pair survived.
        expect(
          connections.some(
            (index) => index.name === `${schemaName}_wconn_status_idx`,
          ),
        ).toBe(true);

        const labels = await indexesOn(schemaName, "whatsapp_labels");
        const tag = labels.find(
          (index) => index.name === `${schemaName}_wl_conn_tag_uidx`,
        );
        expect(tag).toBeDefined();
        expect(tag?.unique).toBe(true);
        expect(tag?.columns).toEqual([
          "whatsapp_connection_id",
          "synced_tag_id",
        ]);
        expect(
          labels.some(
            (index) => index.name === `${schemaName}_wl_conn_label_uidx`,
          ),
        ).toBe(true);

        const scheduled = await indexesOn(schemaName, "scheduled_messages");
        for (const suffix of [
          "_sm_due_idx",
          "_sm_bulk_job_idx",
          "_sm_contact_idx",
        ]) {
          expect(
            scheduled.some((index) => index.name === `${schemaName}${suffix}`),
          ).toBe(true);
        }
      } finally {
        await dropTenantSchema(companyId);
      }
    },
  );

  integrationTest(
    "renames a legacy truncated index in place instead of rebuilding it",
    async () => {
      const companyId = crypto.randomUUID();
      const schemaName = getSchemaName(companyId);

      try {
        await createTenantSchema(companyId);

        // Model a pre-063 tenant: rename one canonical index back to the
        // truncated name the old code produced.
        const target = TENANT_INDEX_TARGETS.find(
          (candidate) => candidate.suffix === "_cs_status_idx",
        );
        if (!target) throw new Error("target fixture missing");
        const canonical = targetIdentifier(schemaName, target);
        const legacy = legacyIdentifier(schemaName, target);
        await sql`
          ALTER INDEX ${sql.raw(`"${schemaName}"."${canonical}"`)}
          RENAME TO ${sql.raw(`"${legacy}"`)}
        `.execute(db);
        const relfilenodeBefore = await sql<{ relfilenode: number }>`
          SELECT c.relfilenode FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = ${schemaName} AND c.relname = ${legacy}
        `.execute(db);

        const result = await reconcileTenantIndexNames(db, schemaName);

        expect(result.renamed).toContain("_cs_status_idx");
        expect(result.created).not.toContain("_cs_status_idx");
        const present = await indexNames(schemaName);
        expect(present.has(canonical)).toBe(true);
        expect(present.has(legacy)).toBe(false);

        // Same physical relation - a rename must not rebuild the index.
        const relfilenodeAfter = await sql<{ relfilenode: number }>`
          SELECT c.relfilenode FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = ${schemaName} AND c.relname = ${canonical}
        `.execute(db);
        expect(relfilenodeAfter.rows[0]?.relfilenode).toBe(
          relfilenodeBefore.rows[0]?.relfilenode as number,
        );
      } finally {
        await dropTenantSchema(companyId);
      }
    },
  );

  integrationTest(
    "recreates an index that a truncation collision had removed",
    async () => {
      const companyId = crypto.randomUUID();
      const schemaName = getSchemaName(companyId);

      try {
        await createTenantSchema(companyId);

        // Model the real collision: the phone UNIQUE index was never built,
        // and its sibling sits under the shared truncated name.
        await sql`
          DROP INDEX ${sql.raw(`"${schemaName}"."${schemaName}_wconn_phone_uidx"`)}
        `.execute(db);
        await sql`
          ALTER INDEX ${sql.raw(`"${schemaName}"."${schemaName}_wconn_status_idx"`)}
          RENAME TO ${sql.raw(
            `"${legacyIdentifier(schemaName, TENANT_INDEX_TARGETS.find((t) => t.suffix === "_wconn_status_idx")!)}"`,
          )}
        `.execute(db);

        const result = await reconcileTenantIndexNames(db, schemaName);

        // The shared truncated name belongs to the status index, so the phone
        // index must be created fresh rather than stealing that name.
        expect(result.created).toContain("_wconn_phone_uidx");
        expect(result.renamed).toContain("_wconn_status_idx");

        const connections = await indexesOn(schemaName, "whatsapp_connections");
        const phone = connections.find(
          (index) => index.name === `${schemaName}_wconn_phone_uidx`,
        );
        expect(phone?.unique).toBe(true);
        expect(phone?.columns).toEqual(["phone_number"]);
        const status = connections.find(
          (index) => index.name === `${schemaName}_wconn_status_idx`,
        );
        expect(status?.unique).toBe(false);
        expect(status?.columns).toEqual(["status"]);
      } finally {
        await dropTenantSchema(companyId);
      }
    },
  );

  integrationTest("is idempotent across repeated runs", async () => {
    const companyId = crypto.randomUUID();
    const schemaName = getSchemaName(companyId);

    try {
      await createTenantSchema(companyId);
      const first = await reconcileTenantIndexNames(db, schemaName);
      const namesAfterFirst = await indexNames(schemaName);

      const second = await reconcileTenantIndexNames(db, schemaName);
      const third = await reconcileTenantIndexNames(db, schemaName);

      // createTenantSchema already reconciled, so even the first extra run
      // should find everything in place.
      expect(first.renamed).toEqual([]);
      expect(first.created).toEqual([]);
      expect(second.renamed).toEqual([]);
      expect(second.created).toEqual([]);
      expect(third.renamed).toEqual([]);
      expect(third.created).toEqual([]);
      expect(third.alreadyCorrect.length).toBe(TENANT_INDEX_TARGETS.length);
      expect(await indexNames(schemaName)).toEqual(namesAfterFirst);
    } finally {
      await dropTenantSchema(companyId);
    }
  });

  integrationTest(
    "the renamed UNIQUE constraint still rejects duplicate messages",
    async () => {
      const companyId = crypto.randomUUID();
      const schemaName = getSchemaName(companyId);

      try {
        await createTenantSchema(companyId);
        const connectionId = crypto.randomUUID();
        const table = sql.raw(`"${schemaName}"."messages"`);

        await sql`
          INSERT INTO ${table} (whatsapp_connection_id, message_id, from_me, message_type, timestamp)
          VALUES (${connectionId}, 'WA-DUP-1', false, 'text', now())
        `.execute(db);

        // The constraint was renamed by reconcile; it must still be enforced.
        let rejected = false;
        try {
          await sql`
            INSERT INTO ${table} (whatsapp_connection_id, message_id, from_me, message_type, timestamp)
            VALUES (${connectionId}, 'WA-DUP-1', false, 'text', now())
          `.execute(db);
        } catch {
          rejected = true;
        }
        expect(rejected).toBe(true);

        const constraint = await sql<{ conname: string }>`
          SELECT conname FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname = ${schemaName} AND t.relname = 'messages'
            AND c.contype = 'u'
        `.execute(db);
        expect(constraint.rows.map((row) => row.conname)).toContain(
          `${schemaName}_msg_wa_uniq`,
        );
      } finally {
        await dropTenantSchema(companyId);
      }
    },
  );
});

describe("UNIQUE creation fails closed on existing duplicates", () => {
  integrationTest(
    "reports conflicting rows and creates nothing, without touching data",
    async () => {
      const companyId = crypto.randomUUID();
      const schemaName = getSchemaName(companyId);

      try {
        await createTenantSchema(companyId);
        const connections = sql.raw(`"${schemaName}"."whatsapp_connections"`);

        // Drop the UNIQUE index, then create the duplicates it would have
        // prevented - exactly the state a tenant is in today.
        await sql`
          DROP INDEX ${sql.raw(`"${schemaName}"."${schemaName}_wconn_phone_uidx"`)}
        `.execute(db);
        await sql`
          INSERT INTO ${connections} (name, phone_number, status)
          VALUES ('A', '15550000001', 'disconnected'),
                 ('B', '15550000001', 'disconnected'),
                 ('C', '15550000002', 'disconnected'),
                 ('D', '15550000002', 'disconnected'),
                 ('E', '15550000003', 'disconnected')
        `.execute(db);

        const result = await reconcileTenantIndexNames(db, schemaName);

        expect(result.created).not.toContain("_wconn_phone_uidx");
        expect(result.blocked).toHaveLength(1);
        const blocker = result.blocked[0];
        expect(blocker.table).toBe("whatsapp_connections");
        expect(blocker.columns).toEqual(["phone_number"]);
        // Two distinct phone numbers are duplicated; the third is unique.
        expect(blocker.totalConflicts).toBe(2);
        expect(blocker.samples.length).toBeGreaterThan(0);

        // Fail-closed: the index is absent rather than forced through.
        expect(
          (await indexNames(schemaName)).has(`${schemaName}_wconn_phone_uidx`),
        ).toBe(false);

        // And crucially: no row was deleted or merged.
        const rows = await sql<{ count: number }>`
          SELECT count(*)::int AS count FROM ${connections}
        `.execute(db);
        expect(rows.rows[0]?.count).toBe(5);
      } finally {
        await dropTenantSchema(companyId);
      }
    },
  );

  integrationTest(
    "succeeds on a later run once the operator resolves the duplicates",
    async () => {
      const companyId = crypto.randomUUID();
      const schemaName = getSchemaName(companyId);

      try {
        await createTenantSchema(companyId);
        const connections = sql.raw(`"${schemaName}"."whatsapp_connections"`);
        await sql`
          DROP INDEX ${sql.raw(`"${schemaName}"."${schemaName}_wconn_phone_uidx"`)}
        `.execute(db);
        await sql`
          INSERT INTO ${connections} (name, phone_number, status)
          VALUES ('A', '15550000009', 'disconnected'),
                 ('B', '15550000009', 'disconnected')
        `.execute(db);

        expect(
          (await reconcileTenantIndexNames(db, schemaName)).blocked,
        ).toHaveLength(1);

        // The operator resolves it however their business requires; here, by
        // renaming one. The migration never does this itself.
        await sql`
          UPDATE ${connections} SET phone_number = '15550000010' WHERE name = 'B'
        `.execute(db);

        const retry = await reconcileTenantIndexNames(db, schemaName);
        expect(retry.blocked).toEqual([]);
        expect(retry.created).toContain("_wconn_phone_uidx");
        expect(
          (await indexNames(schemaName)).has(`${schemaName}_wconn_phone_uidx`),
        ).toBe(true);
      } finally {
        await dropTenantSchema(companyId);
      }
    },
  );

  integrationTest(
    "a partial-index predicate excludes rows it does not cover",
    async () => {
      const companyId = crypto.randomUUID();
      const schemaName = getSchemaName(companyId);

      try {
        await createTenantSchema(companyId);
        const connections = sql.raw(`"${schemaName}"."whatsapp_connections"`);
        await sql`
          DROP INDEX ${sql.raw(`"${schemaName}"."${schemaName}_wconn_phone_uidx"`)}
        `.execute(db);
        // Several NULL phone numbers: the index is partial on IS NOT NULL, so
        // these are not duplicates and must not block creation.
        await sql`
          INSERT INTO ${connections} (name, phone_number, status)
          VALUES ('A', NULL, 'disconnected'),
                 ('B', NULL, 'disconnected'),
                 ('C', NULL, 'disconnected')
        `.execute(db);

        const result = await reconcileTenantIndexNames(db, schemaName);
        expect(result.blocked).toEqual([]);
        expect(result.created).toContain("_wconn_phone_uidx");
      } finally {
        await dropTenantSchema(companyId);
      }
    },
  );
});

describe("redundant duplicates are healed, siblings are not", () => {
  integrationTest(
    "drops a legacy index that exactly duplicates the canonical one",
    async () => {
      const companyId = crypto.randomUUID();
      const schemaName = getSchemaName(companyId);

      try {
        await createTenantSchema(companyId);
        const target = TENANT_INDEX_TARGETS.find(
          (candidate) => candidate.suffix === "_bj_status_idx",
        );
        if (!target) throw new Error("target fixture missing");
        const legacy = legacyIdentifier(schemaName, target);

        // Model an exact clone under the historical truncated name.
        await sql`
          CREATE INDEX ${sql.raw(`"${legacy}"`)}
          ON ${sql.raw(`"${schemaName}"."bulk_jobs"`)} (status, scheduled_at)
        `.execute(db);
        expect((await indexNames(schemaName)).has(legacy)).toBe(true);

        const result = await reconcileTenantIndexNames(db, schemaName);

        expect(result.droppedRedundant).toContain("_bj_status_idx");
        const present = await indexNames(schemaName);
        expect(present.has(legacy)).toBe(false);
        // The canonical one survives - the guarantee is never lost.
        expect(present.has(targetIdentifier(schemaName, target))).toBe(true);
      } finally {
        await dropTenantSchema(companyId);
      }
    },
  );

  integrationTest(
    "leaves a differently-shaped index that merely shares the legacy name",
    async () => {
      const companyId = crypto.randomUUID();
      const schemaName = getSchemaName(companyId);

      try {
        await createTenantSchema(companyId);
        const phone = TENANT_INDEX_TARGETS.find(
          (candidate) => candidate.suffix === "_wconn_phone_uidx",
        );
        if (!phone) throw new Error("target fixture missing");
        // Both phone and status truncate to this same legacy name. Put a
        // DIFFERENTLY shaped index there; it must not be dropped as a
        // "duplicate" of the phone index.
        const shared = legacyIdentifier(schemaName, phone);
        await sql`
          CREATE INDEX ${sql.raw(`"${shared}"`)}
          ON ${sql.raw(`"${schemaName}"."whatsapp_connections"`)} (jid)
        `.execute(db);

        const result = await reconcileTenantIndexNames(db, schemaName);

        expect(result.droppedRedundant).not.toContain("_wconn_phone_uidx");
        expect((await indexNames(schemaName)).has(shared)).toBe(true);
      } finally {
        await dropTenantSchema(companyId);
      }
    },
  );
});
