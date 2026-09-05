import { expect, test } from "bun:test";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { installOutboxDispatchTrigger } from "./dispatch-schema.js";
import { down, up } from "./migrations/084_add_background_dispatch.js";

const integration = process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

integration(
  "migration backfills old outboxes, supports new tenants, and rolls back additively",
  async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1"].includes(url.hostname))
      throw new Error("Local test database required");
    const databaseName = `dispatch_migration_${crypto.randomUUID().replaceAll("-", "")}`;
    const admin = new Kysely<unknown>({
      dialect: new PostgresDialect({
        pool: new Pool({ connectionString: url.toString(), max: 1 }),
      }),
    });
    await sql`CREATE DATABASE ${sql.id(databaseName)}`.execute(admin);
    url.pathname = `/${databaseName}`;
    const db = new Kysely<unknown>({
      dialect: new PostgresDialect({
        pool: new Pool({ connectionString: url.toString(), max: 1 }),
      }),
    });
    const company = crypto.randomUUID();
    const schema = `tenant_${company.replaceAll("-", "_")}`;
    const outbox = sql.table(`${schema}.nats_outbox`);
    try {
      await sql`CREATE SCHEMA ${sql.id(schema)}`.execute(db);
      await sql`CREATE TABLE ${outbox} (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), status TEXT NOT NULL DEFAULT 'pending', next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now())`.execute(
        db,
      );
      await sql`INSERT INTO ${outbox} DEFAULT VALUES`.execute(db);
      await up(db);
      expect(
        (await sql`SELECT * FROM public.outbox_dispatch_ready`.execute(db))
          .rows,
      ).toHaveLength(1);
      const before = (
        await sql<{
          generation: string;
        }>`SELECT generation FROM public.outbox_dispatch_ready`.execute(db)
      ).rows[0]!.generation;
      await sql`INSERT INTO ${outbox} DEFAULT VALUES`.execute(db);
      expect(
        BigInt(
          (
            await sql<{
              generation: string;
            }>`SELECT generation FROM public.outbox_dispatch_ready`.execute(db)
          ).rows[0]!.generation,
        ),
      ).toBe(BigInt(before) + 1n);
      await expect(
        db.transaction().execute(async (trx) => {
          await sql`INSERT INTO ${outbox} DEFAULT VALUES`.execute(trx);
          throw new Error("rollback writer");
        }),
      ).rejects.toThrow("rollback writer");
      expect(
        (await sql`SELECT * FROM ${outbox}`.execute(db)).rows,
      ).toHaveLength(2);
      // Idempotent new-tenant reconciliation does not replace a live trigger.
      await installOutboxDispatchTrigger(db, schema);
      await installOutboxDispatchTrigger(db, schema);
      await down(db);
      await sql`INSERT INTO ${outbox} DEFAULT VALUES`.execute(db);
      expect(
        (await sql`SELECT * FROM ${outbox}`.execute(db)).rows,
      ).toHaveLength(3);
      await up(db);
      expect(
        (await sql`SELECT * FROM public.outbox_dispatch_ready`.execute(db))
          .rows,
      ).toHaveLength(1);
    } finally {
      await db.destroy();
      await sql`DROP DATABASE ${sql.id(databaseName)}`.execute(admin);
      await admin.destroy();
    }
  },
  120_000,
);
