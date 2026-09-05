/** Synthetic idle-tenant benchmark. Never accepts a production database. */
import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import {
  dispatchCompany,
  dispatchPendingCommands,
} from "../services/command-outbox.service.js";
import {
  getSchemaName,
  shutdownTenantConnections,
} from "../services/tenant.service.js";

const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (
  url.hostname !== "127.0.0.1" ||
  url.port !== "4547" ||
  url.pathname !== "/wati_dispatch_test"
)
  throw new Error(
    "Benchmark requires the isolated loopback dispatch database on port 4547",
  );
const existing = await db
  .selectFrom("companies")
  .select("id")
  .where("status", "=", "active")
  .execute();
if (existing.length)
  throw new Error("Run only when no other integration fixtures are active");

const ids = Array.from({ length: 200 }, () => crypto.randomUUID());
try {
  await db.transaction().execute(async (trx) => {
    for (const id of ids) {
      const schema = getSchemaName(id);
      await trx
        .insertInto("companies")
        .values({
          id,
          name: "Idle benchmark",
          schema_name: schema,
          status: "active",
        })
        .execute();
      await sql`CREATE SCHEMA ${sql.id(schema)}`.execute(trx);
      await sql`CREATE TABLE ${sql.table(`${schema}.nats_outbox`)} (
        id UUID PRIMARY KEY, subject TEXT, payload JSONB, status TEXT,
        attempts INT, next_attempt_at TIMESTAMPTZ, created_at TIMESTAMPTZ
      )`.execute(trx);
    }
    // Benchmark the hot loop; recovery overhead is separately bounded at ten
    // tenants/minute across replicas, not repeated in each measured iteration.
    await sql`UPDATE public.outbox_dispatch_recovery SET next_run_at = now() + interval '1 hour' WHERE id = 1`.execute(
      trx,
    );
  });
  const measure = async (fn: () => Promise<unknown>) => {
    const times: number[] = [];
    for (let round = 0; round < 3; round++) {
      const start = performance.now();
      await fn();
      times.push(Math.round((performance.now() - start) * 100) / 100);
    }
    return times;
  };
  const scanMs = await measure(async () => {
    const companies = await db
      .selectFrom("companies")
      .select("id")
      .where("status", "=", "active")
      .execute();
    for (const company of companies) await dispatchCompany(company.id);
  });
  const readyMs = await measure(dispatchPendingCommands);
  console.log(
    JSON.stringify(
      {
        idleWorkspaces: ids.length,
        rounds: 3,
        scanMs,
        readyMs,
        note: "Synthetic idle dispatch only; excludes search, network delivery and periodic recovery. Not a production throughput benchmark.",
      },
      null,
      2,
    ),
  );
} finally {
  await db.transaction().execute(async (trx) => {
    for (const id of ids) {
      await sql`DROP SCHEMA IF EXISTS ${sql.id(getSchemaName(id))} CASCADE`.execute(
        trx,
      );
      await trx.deleteFrom("companies").where("id", "=", id).execute();
    }
    await sql`UPDATE public.outbox_dispatch_recovery SET next_run_at = now(), cursor = NULL WHERE id = 1`.execute(
      trx,
    );
  });
  await shutdownTenantConnections();
  await db.destroy();
}
