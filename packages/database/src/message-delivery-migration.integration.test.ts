import { expect, test } from "bun:test";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { up as createWorkerOutbox } from "./migrations/051_add_worker_event_outbox.js";
import { up as installDispatch } from "./migrations/084_add_background_dispatch.js";
import { down, up } from "./migrations/086_add_history_apply_barrier.js";

const integration = process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

integration(
  "message delivery migration preserves queued events and supports old writers and rollback",
  async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1"].includes(url.hostname))
      throw new Error("Local test database required");
    const databaseName = `delivery_migration_${crypto.randomUUID().replaceAll("-", "")}`;
    const connect = () =>
      new Kysely<unknown>({
        dialect: new PostgresDialect({
          pool: new Pool({ connectionString: url.toString(), max: 1 }),
        }),
      });
    const admin = connect();
    await sql`CREATE DATABASE ${sql.id(databaseName)}`.execute(admin);
    url.pathname = `/${databaseName}`;
    const db = connect();
    const company = crypto.randomUUID();
    const schema = `tenant_${company.replaceAll("-", "_")}`;
    const session = crypto.randomUUID();
    const original = crypto.randomUUID();
    const payload = Buffer.from('{"contractVersion":1}');
    const insertLegacyEvent = (id: string) =>
      sql`INSERT INTO whatsapp_sessions.worker_event_outbox
        (connection_id, event_id, subject, payload)
        VALUES (${session}::uuid, ${id}::uuid,
          ${`WHATSAPP.events.${company}.${session}.history_message`}, ${payload})`.execute(
        db,
      );
    try {
      await sql`CREATE SCHEMA whatsapp_sessions`.execute(db);
      await createWorkerOutbox(db);
      await sql`CREATE SCHEMA ${sql.id(schema)}`.execute(db);
      await sql`CREATE TABLE ${sql.table(`${schema}.nats_outbox`)} (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        subject TEXT NOT NULL, payload JSONB NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`.execute(db);
      await installDispatch(db);
      await insertLegacyEvent(original);
      await db.transaction().execute(up);
      const queued = await sql<{
        event_order: string;
        published_at: Date | null;
        payload: Buffer;
      }>`SELECT event_order, published_at, payload
        FROM whatsapp_sessions.worker_event_outbox WHERE event_id = ${original}::uuid`.execute(
        db,
      );
      expect(BigInt(queued.rows[0]!.event_order)).toBeGreaterThan(0n);
      expect(queued.rows[0]!.published_at).toBeNull();
      expect(queued.rows[0]!.payload).toEqual(payload);
      expect(
        (
          await sql<{ present: boolean }>`SELECT to_regclass(
            ${`${schema}.${schema}_outbox_to_idx`}) IS NOT NULL AS present`.execute(
            db,
          )
        ).rows[0]!.present,
      ).toBe(true);
      // The previous worker can still enqueue while the API is being upgraded.
      await insertLegacyEvent(crypto.randomUUID());
      const ordered = await sql<{ event_order: string }>`SELECT event_order
        FROM whatsapp_sessions.worker_event_outbox ORDER BY event_order`.execute(
        db,
      );
      expect(BigInt(ordered.rows[1]!.event_order)).toBeGreaterThan(
        BigInt(ordered.rows[0]!.event_order),
      );
      await db.transaction().execute(down);
      await insertLegacyEvent(crypto.randomUUID());
      expect(
        (
          await sql`SELECT * FROM whatsapp_sessions.worker_event_outbox`.execute(
            db,
          )
        ).rows,
      ).toHaveLength(3);
      // Reapplying the additive schema must preserve the queue as well.
      await db.transaction().execute(up);
      expect(
        (
          await sql`SELECT * FROM whatsapp_sessions.worker_event_outbox`.execute(
            db,
          )
        ).rows,
      ).toHaveLength(3);
    } finally {
      await db.destroy();
      await sql`DROP DATABASE ${sql.id(databaseName)}`.execute(admin);
      await admin.destroy();
    }
  },
  120_000,
);
