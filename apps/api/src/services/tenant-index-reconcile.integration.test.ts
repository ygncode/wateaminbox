import { describe, expect, test } from "bun:test";
import {
  db,
  dropLegacyLabelUniqueIndex,
  legacyIdentifier,
  preflightTenantIndexNames,
  reconcileTenantIndexNames,
  renameTenantRelation,
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

/**
 * `_msg_wa_uniq` is the one target declared as a table CONSTRAINT, but the
 * adoption branch matches on SHAPE - so it can select a bare UNIQUE index that
 * has no backing constraint. `ALTER TABLE ... RENAME CONSTRAINT` errors on one
 * of those, which would abort the whole migration mid-run.
 *
 * This is reachable in practice: the operations guide tells operators to build
 * a heavy index by hand with `CREATE INDEX CONCURRENTLY` before the window.
 */
describe("adopting a bare index for a constraint target", () => {
  integrationTest(
    "renames a hand-built UNIQUE index rather than aborting",
    async () => {
      const companyId = crypto.randomUUID();
      const schemaName = getSchemaName(companyId);

      try {
        await createTenantSchema(companyId);
        const messages = sql.raw(`"${schemaName}"."messages"`);

        // Drop the real constraint and stand up an equivalent bare index under
        // a name of the operator's choosing - not the canonical one.
        await sql`
          ALTER TABLE ${messages}
          DROP CONSTRAINT ${sql.raw(`"${schemaName}_msg_wa_uniq"`)}
        `.execute(db);
        await sql`
          CREATE UNIQUE INDEX ${sql.raw(`"${schemaName}_handbuilt_wa_uidx"`)}
          ON ${messages} (whatsapp_connection_id, message_id)
        `.execute(db);

        const result = await reconcileTenantIndexNames(db, schemaName);

        expect(result.renamed).toContain("_msg_wa_uniq");
        expect(result.blocked).toEqual([]);

        // Adopted under the canonical name, and still enforcing.
        const present = await indexNames(schemaName);
        expect(present.has(`${schemaName}_msg_wa_uniq`)).toBe(true);
        expect(present.has(`${schemaName}_handbuilt_wa_uidx`)).toBe(false);

        const connectionId = crypto.randomUUID();
        await sql`
          INSERT INTO ${messages} (whatsapp_connection_id, message_id, from_me, message_type, timestamp)
          VALUES (${connectionId}, 'WA-ADOPT-1', false, 'text', now())
        `.execute(db);
        let rejected = false;
        try {
          await sql`
            INSERT INTO ${messages} (whatsapp_connection_id, message_id, from_me, message_type, timestamp)
            VALUES (${connectionId}, 'WA-ADOPT-1', false, 'text', now())
          `.execute(db);
        } catch {
          rejected = true;
        }
        expect(rejected).toBe(true);

        // And a second run finds nothing left to do.
        const again = await reconcileTenantIndexNames(db, schemaName);
        expect(again.renamed).toEqual([]);
        expect(again.created).toEqual([]);
      } finally {
        await dropTenantSchema(companyId);
      }
    },
  );
});

/**
 * Migration 063's `down` reverses renames through the same helper `up` uses.
 * A rollback that half-applies is worse than one that does not run, so both
 * directions are exercised - including the CONSTRAINT target, whose rename
 * goes through `ALTER TABLE ... RENAME CONSTRAINT` rather than `ALTER INDEX`.
 */
describe("rename round-trips in both directions", () => {
  integrationTest(
    "a constraint and an index both survive down-then-up intact",
    async () => {
      const companyId = crypto.randomUUID();
      const schemaName = getSchemaName(companyId);

      try {
        await createTenantSchema(companyId);

        for (const suffix of ["_msg_wa_uniq", "_cs_status_idx"]) {
          const target = TENANT_INDEX_TARGETS.find(
            (candidate) => candidate.suffix === suffix,
          );
          if (!target) throw new Error(`target fixture missing: ${suffix}`);
          const canonical = targetIdentifier(schemaName, target);
          const legacy = legacyIdentifier(schemaName, target);

          // What 063's `down` does.
          await renameTenantRelation(db, schemaName, target, canonical, legacy);
          const rolledBack = await indexNames(schemaName);
          expect(rolledBack.has(legacy)).toBe(true);
          expect(rolledBack.has(canonical)).toBe(false);

          // And forward again.
          await renameTenantRelation(db, schemaName, target, legacy, canonical);
          const reapplied = await indexNames(schemaName);
          expect(reapplied.has(canonical)).toBe(true);
          expect(reapplied.has(legacy)).toBe(false);
        }

        // The UNIQUE target must still be a table CONSTRAINT, not merely an
        // index that happens to share its name.
        const constraints = await sql<{ conname: string }>`
          SELECT conname FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname = ${schemaName} AND t.relname = 'messages'
            AND c.contype = 'u'
        `.execute(db);
        expect(constraints.rows.map((row) => row.conname)).toContain(
          `${schemaName}_msg_wa_uniq`,
        );

        // And reconciliation agrees there is nothing left to do.
        const result = await reconcileTenantIndexNames(db, schemaName);
        expect(result.renamed).toEqual([]);
        expect(result.created).toEqual([]);
        expect(result.droppedRedundant).toEqual([]);
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

describe("legacy label uniqueness index cleanup", () => {
  integrationTest(
    "drops the pre-054 connection-less index, schema-qualified",
    async () => {
      const companyId = crypto.randomUUID();
      const schemaName = getSchemaName(companyId);
      // The name the server actually stores: the intended one is 70 chars.
      const legacy = `${schemaName}_whatsapp_labels_label_uidx`.slice(0, 63);

      try {
        await createTenantSchema(companyId);
        // Model a tenant that predates connection-scoped labels.
        await sql`
          CREATE UNIQUE INDEX ${sql.raw(`"${legacy}"`)}
          ON ${sql.raw(`"${schemaName}"."whatsapp_labels"`)} (label_id)
        `.execute(db);
        expect((await indexNames(schemaName)).has(legacy)).toBe(true);

        // The reconcile path is what runs this; it used to be a silent no-op
        // because the identifier was unqualified and untruncated.
        expect(await dropLegacyLabelUniqueIndex(db, schemaName)).toBe(true);
        expect((await indexNames(schemaName)).has(legacy)).toBe(false);
      } finally {
        await dropTenantSchema(companyId);
      }
    },
  );

  integrationTest("is a no-op when the legacy index is absent", async () => {
    const companyId = crypto.randomUUID();
    const schemaName = getSchemaName(companyId);
    try {
      await createTenantSchema(companyId);
      const before = await indexNames(schemaName);
      expect(await dropLegacyLabelUniqueIndex(db, schemaName)).toBe(false);
      expect(await indexNames(schemaName)).toEqual(before);
    } finally {
      await dropTenantSchema(companyId);
    }
  });

  integrationTest(
    "refuses to drop a differently-shaped index under that name",
    async () => {
      // A truncation collision must never turn this into a destructive
      // surprise: only a UNIQUE index on exactly (label_id) qualifies.
      const companyId = crypto.randomUUID();
      const schemaName = getSchemaName(companyId);
      const legacy = `${schemaName}_whatsapp_labels_label_uidx`.slice(0, 63);

      try {
        await createTenantSchema(companyId);
        await sql`
          CREATE INDEX ${sql.raw(`"${legacy}"`)}
          ON ${sql.raw(`"${schemaName}"."whatsapp_labels"`)} (name)
        `.execute(db);

        expect(await dropLegacyLabelUniqueIndex(db, schemaName)).toBe(false);
        expect((await indexNames(schemaName)).has(legacy)).toBe(true);
      } finally {
        await dropTenantSchema(companyId);
      }
    },
  );

  integrationTest(
    "a newly created tenant carries no legacy label index",
    async () => {
      const companyId = crypto.randomUUID();
      const schemaName = getSchemaName(companyId);
      try {
        await createTenantSchema(companyId);
        const legacy = `${schemaName}_whatsapp_labels_label_uidx`.slice(0, 63);
        expect((await indexNames(schemaName)).has(legacy)).toBe(false);
      } finally {
        await dropTenantSchema(companyId);
      }
    },
  );
});

/**
 * Migration 063 builds four indexes non-concurrently, so an operator needs to
 * know before the window which builds take a lock and whether duplicate rows
 * will abort the run.
 */
describe("migration 063 preflight", () => {
  integrationTest("reports a clean tenant as requiring no work", async () => {
    const companyId = crypto.randomUUID();
    const schemaName = getSchemaName(companyId);
    try {
      await createTenantSchema(companyId);
      const [row] = await preflightTenantIndexNames(db, [schemaName]);
      expect(row.willRename).toEqual([]);
      expect(row.willCreate).toEqual([]);
      expect(row.blocked).toEqual([]);
    } finally {
      await dropTenantSchema(companyId);
    }
  });

  integrationTest(
    "reports the build and its row estimate without changing anything",
    async () => {
      const companyId = crypto.randomUUID();
      const schemaName = getSchemaName(companyId);
      try {
        await createTenantSchema(companyId);
        await sql`
          DROP INDEX ${sql.raw(`"${schemaName}"."${schemaName}_wconn_phone_uidx"`)}
        `.execute(db);

        const [row] = await preflightTenantIndexNames(db, [schemaName]);
        expect(row.willCreate.map((entry) => entry.suffix)).toContain(
          "_wconn_phone_uidx",
        );
        const entry = row.willCreate.find(
          (candidate) => candidate.suffix === "_wconn_phone_uidx",
        );
        expect(entry?.table).toBe("whatsapp_connections");
        expect(typeof entry?.estimatedRows).toBe("number");

        // Preflight is read-only: the index is still missing afterwards.
        expect(
          (await indexNames(schemaName)).has(`${schemaName}_wconn_phone_uidx`),
        ).toBe(false);
      } finally {
        await dropTenantSchema(companyId);
      }
    },
  );

  integrationTest(
    "reports duplicates that would abort, and changes no rows",
    async () => {
      const companyId = crypto.randomUUID();
      const schemaName = getSchemaName(companyId);
      try {
        await createTenantSchema(companyId);
        await sql`
          DROP INDEX ${sql.raw(`"${schemaName}"."${schemaName}_wconn_phone_uidx"`)}
        `.execute(db);
        await sql`
          INSERT INTO ${sql.raw(`"${schemaName}"."whatsapp_connections"`)}
            (name, phone_number, status)
          VALUES ('A', '15557770001', 'disconnected'),
                 ('B', '15557770001', 'disconnected')
        `.execute(db);

        const [row] = await preflightTenantIndexNames(db, [schemaName]);
        expect(row.blocked).toHaveLength(1);
        expect(row.blocked[0].table).toBe("whatsapp_connections");
        expect(row.blocked[0].totalConflicts).toBe(1);
        // A blocked target is reported instead of scheduled for creation.
        expect(row.willCreate.map((entry) => entry.suffix)).not.toContain(
          "_wconn_phone_uidx",
        );

        const rows = await sql<{ count: number }>`
          SELECT count(*)::int AS count
          FROM ${sql.raw(`"${schemaName}"."whatsapp_connections"`)}
        `.execute(db);
        expect(rows.rows[0]?.count).toBe(2);
      } finally {
        await dropTenantSchema(companyId);
      }
    },
  );
});

/**
 * Preflight and reconciliation both call `planTenantIndexAction`, so a report
 * can never promise something different from what the migration then does.
 * Two copies of that decision logic would drift silently - and the whole point
 * of a preflight is that operators can trust it.
 */
describe("preflight agrees with what reconciliation does", () => {
  integrationTest(
    "a tenant needing renames and a build is predicted exactly",
    async () => {
      const companyId = crypto.randomUUID();
      const schemaName = getSchemaName(companyId);

      try {
        await createTenantSchema(companyId);

        // One target back under its legacy name (=> rename), one removed
        // entirely (=> create).
        const renameTarget = TENANT_INDEX_TARGETS.find(
          (candidate) => candidate.suffix === "_cs_status_idx",
        );
        if (!renameTarget) throw new Error("target fixture missing");
        await sql`
          ALTER INDEX ${sql.raw(
            `"${schemaName}"."${targetIdentifier(schemaName, renameTarget)}"`,
          )}
          RENAME TO ${sql.raw(`"${legacyIdentifier(schemaName, renameTarget)}"`)}
        `.execute(db);
        await sql`
          DROP INDEX ${sql.raw(`"${schemaName}"."${schemaName}_sm_due_idx"`)}
        `.execute(db);

        const [predicted] = await preflightTenantIndexNames(db, [schemaName]);
        const applied = await reconcileTenantIndexNames(db, schemaName);

        expect(predicted.willRename.sort()).toEqual(applied.renamed.sort());
        expect(
          predicted.willCreate.map((entry) => entry.suffix).sort(),
        ).toEqual(applied.created.sort());
        expect(predicted.willDrop.sort()).toEqual(
          applied.droppedRedundant.sort(),
        );
        expect(predicted.blocked).toEqual(applied.blocked);
      } finally {
        await dropTenantSchema(companyId);
      }
    },
  );

  integrationTest("a blocked tenant is predicted as blocked", async () => {
    const companyId = crypto.randomUUID();
    const schemaName = getSchemaName(companyId);

    try {
      await createTenantSchema(companyId);
      await sql`
        DROP INDEX ${sql.raw(`"${schemaName}"."${schemaName}_wconn_phone_uidx"`)}
      `.execute(db);
      await sql`
        INSERT INTO ${sql.raw(`"${schemaName}"."whatsapp_connections"`)}
          (name, phone_number, status)
        VALUES ('A', '15558880001', 'disconnected'),
               ('B', '15558880001', 'disconnected')
      `.execute(db);

      const [predicted] = await preflightTenantIndexNames(db, [schemaName]);
      const applied = await reconcileTenantIndexNames(db, schemaName);

      expect(predicted.blocked.map((entry) => entry.indexName)).toEqual(
        applied.blocked.map((entry) => entry.indexName),
      );
      expect(predicted.willCreate.map((entry) => entry.suffix)).not.toContain(
        "_wconn_phone_uidx",
      );
      expect(applied.created).not.toContain("_wconn_phone_uidx");
    } finally {
      await dropTenantSchema(companyId);
    }
  });

  integrationTest(
    "a clean tenant predicts, and performs, no work at all",
    async () => {
      const companyId = crypto.randomUUID();
      const schemaName = getSchemaName(companyId);
      try {
        await createTenantSchema(companyId);
        const [predicted] = await preflightTenantIndexNames(db, [schemaName]);
        const applied = await reconcileTenantIndexNames(db, schemaName);

        expect(predicted.willRename).toEqual([]);
        expect(predicted.willCreate).toEqual([]);
        expect(predicted.willDrop).toEqual([]);
        expect(applied.renamed).toEqual([]);
        expect(applied.created).toEqual([]);
        expect(applied.droppedRedundant).toEqual([]);
      } finally {
        await dropTenantSchema(companyId);
      }
    },
  );
});

/**
 * The preflight is what an operator reads before a deploy window, so it has to
 * report every tenant - not stop at the first one that is blocked - and it must
 * attribute each finding to the right schema.
 */
describe("preflight reports every tenant independently", () => {
  integrationTest(
    "a blocked tenant does not hide a healthy tenant's pending work",
    async () => {
      const blockedId = crypto.randomUUID();
      const workingId = crypto.randomUUID();
      const blockedSchema = getSchemaName(blockedId);
      const workingSchema = getSchemaName(workingId);

      try {
        await createTenantSchema(blockedId);
        await createTenantSchema(workingId);

        // Tenant 1: duplicates make the UNIQUE index impossible.
        await sql`
          DROP INDEX ${sql.raw(`"${blockedSchema}"."${blockedSchema}_wconn_phone_uidx"`)}
        `.execute(db);
        await sql`
          INSERT INTO ${sql.raw(`"${blockedSchema}"."whatsapp_connections"`)}
            (name, phone_number, status)
          VALUES ('A', '15556660001', 'disconnected'),
                 ('B', '15556660001', 'disconnected')
        `.execute(db);

        // Tenant 2: simply missing the index, no conflicts.
        await sql`
          DROP INDEX ${sql.raw(`"${workingSchema}"."${workingSchema}_wconn_phone_uidx"`)}
        `.execute(db);

        const report = await preflightTenantIndexNames(db, [
          blockedSchema,
          workingSchema,
        ]);

        expect(report).toHaveLength(2);
        const blockedRow = report.find(
          (row) => row.schemaName === blockedSchema,
        );
        const workingRow = report.find(
          (row) => row.schemaName === workingSchema,
        );

        expect(blockedRow?.blocked).toHaveLength(1);
        expect(blockedRow?.blocked[0].schemaName).toBe(blockedSchema);
        // The healthy tenant's build is still reported, not swallowed.
        expect(workingRow?.blocked).toEqual([]);
        expect(workingRow?.willCreate.map((entry) => entry.suffix)).toContain(
          "_wconn_phone_uidx",
        );
      } finally {
        await dropTenantSchema(blockedId);
        await dropTenantSchema(workingId);
      }
    },
  );

  integrationTest(
    "reconciling a blocked tenant leaves other tenants reconcilable",
    async () => {
      // Fail-closed is per target and per tenant: the blocked UNIQUE index is
      // skipped, everything else in that tenant still applies, and a second
      // tenant is unaffected.
      const blockedId = crypto.randomUUID();
      const workingId = crypto.randomUUID();
      const blockedSchema = getSchemaName(blockedId);
      const workingSchema = getSchemaName(workingId);

      try {
        await createTenantSchema(blockedId);
        await createTenantSchema(workingId);

        await sql`
          DROP INDEX ${sql.raw(`"${blockedSchema}"."${blockedSchema}_wconn_phone_uidx"`)}
        `.execute(db);
        await sql`
          INSERT INTO ${sql.raw(`"${blockedSchema}"."whatsapp_connections"`)}
            (name, phone_number, status)
          VALUES ('A', '15556660002', 'disconnected'),
                 ('B', '15556660002', 'disconnected')
        `.execute(db);
        // An unrelated, unblocked target in the SAME tenant.
        await sql`
          DROP INDEX ${sql.raw(`"${blockedSchema}"."${blockedSchema}_sm_due_idx"`)}
        `.execute(db);

        const blockedResult = await reconcileTenantIndexNames(
          db,
          blockedSchema,
        );
        expect(blockedResult.blocked).toHaveLength(1);
        // The safe work in the blocked tenant still happened.
        expect(blockedResult.created).toContain("_sm_due_idx");

        const workingResult = await reconcileTenantIndexNames(
          db,
          workingSchema,
        );
        expect(workingResult.blocked).toEqual([]);

        // And no row was touched to force the UNIQUE index through.
        const rows = await sql<{ count: number }>`
          SELECT count(*)::int AS count
          FROM ${sql.raw(`"${blockedSchema}"."whatsapp_connections"`)}
        `.execute(db);
        expect(rows.rows[0]?.count).toBe(2);
      } finally {
        await dropTenantSchema(blockedId);
        await dropTenantSchema(workingId);
      }
    },
  );

  integrationTest("an empty tenant list produces an empty report", async () => {
    expect(await preflightTenantIndexNames(db, [])).toEqual([]);
  });

  integrationTest(
    "a schema that does not exist is reported as needing nothing",
    async () => {
      // Not an error: a schema can vanish between listing and preflight.
      const [row] = await preflightTenantIndexNames(db, [
        getSchemaName(crypto.randomUUID()),
      ]);
      expect(row.willCreate).toEqual([]);
      expect(row.willRename).toEqual([]);
      expect(row.blocked).toEqual([]);
    },
  );
});
