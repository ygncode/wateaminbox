import { afterEach, describe, expect, test } from "bun:test";
import { sql } from "kysely";
import { createDatabase } from "./client.js";
import { up as applyWorkerRoleIsolation } from "./migrations/072_restrict_worker_control_plane.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

const createdRoles: string[] = [];
const createdObjects: string[] = [];

afterEach(async () => {
  const database = createDatabase(process.env.DATABASE_URL || "");
  try {
    for (const object of createdObjects.splice(0).reverse()) {
      await sql
        .raw(object)
        .execute(database)
        .catch(() => undefined);
    }
    for (const role of createdRoles.splice(0).reverse()) {
      await sql
        .raw(`DROP ROLE IF EXISTS ${quoteIdentifier(role)}`)
        .execute(database);
    }
  } finally {
    await database.destroy();
  }
});

describe("restricted PostgreSQL worker role", () => {
  integrationTest(
    "changes privileges without rewriting live worker/session rows",
    async () => {
      const database = createDatabase(process.env.DATABASE_URL || "");
      try {
        const before = await sql<{
          registry_count: number;
          registry_fingerprint: string;
          device_count: number;
          device_fingerprint: string;
        }>`
        SELECT
          (SELECT count(*)::integer FROM public.worker_registry) AS registry_count,
          (SELECT md5(COALESCE(string_agg(row_to_json(r)::text, '' ORDER BY r.connection_id), ''))
             FROM public.worker_registry r) AS registry_fingerprint,
          (SELECT count(*)::integer FROM whatsapp_sessions.whatsmeow_device) AS device_count,
          (SELECT md5(COALESCE(string_agg(row_to_json(d)::text, '' ORDER BY d.connection_id, d.jid), ''))
             FROM whatsapp_sessions.whatsmeow_device d) AS device_fingerprint
      `.execute(database);
        await applyWorkerRoleIsolation(database);
        const after = await sql<{
          registry_count: number;
          registry_fingerprint: string;
          device_count: number;
          device_fingerprint: string;
        }>`
        SELECT
          (SELECT count(*)::integer FROM public.worker_registry) AS registry_count,
          (SELECT md5(COALESCE(string_agg(row_to_json(r)::text, '' ORDER BY r.connection_id), ''))
             FROM public.worker_registry r) AS registry_fingerprint,
          (SELECT count(*)::integer FROM whatsapp_sessions.whatsmeow_device) AS device_count,
          (SELECT md5(COALESCE(string_agg(row_to_json(d)::text, '' ORDER BY d.connection_id, d.jid), ''))
             FROM whatsapp_sessions.whatsmeow_device d) AS device_fingerprint
      `.execute(database);
        expect(after.rows[0]).toEqual(before.rows[0]);
      } finally {
        await database.destroy();
      }
    },
  );

  integrationTest(
    "allows runtime stores while denying control plane, tenants, migrations, and hostile SQL",
    async () => {
      const admin = createDatabase(process.env.DATABASE_URL || "");
      const role = `worker_test_${crypto.randomUUID().replaceAll("-", "")}`;
      const password = `WorkerTest_${crypto.randomUUID().replaceAll("-", "")}`;
      const tenantSchema = `tenant_worker_deny_${crypto.randomUUID().replaceAll("-", "")}`;
      const runtimeTable = `worker_grant_${crypto.randomUUID().replaceAll("-", "")}`;
      const publicTable = `worker_deny_${crypto.randomUUID().replaceAll("-", "")}`;
      const hostileFunction = `worker_deny_fn_${crypto.randomUUID().replaceAll("-", "")}`;
      createdRoles.push(role);
      createdObjects.push(
        `DROP TABLE IF EXISTS public.worker_escape`,
        `DROP FUNCTION IF EXISTS public.${quoteIdentifier(hostileFunction)}()`,
        `DROP TABLE IF EXISTS public.${quoteIdentifier(publicTable)}`,
        `DROP TABLE IF EXISTS whatsapp_sessions.${quoteIdentifier(runtimeTable)}`,
        `DROP SCHEMA IF EXISTS ${quoteIdentifier(tenantSchema)} CASCADE`,
      );
      try {
        await sql
          .raw(
            `CREATE ROLE ${quoteIdentifier(role)} LOGIN PASSWORD ${quoteLiteral(password)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`,
          )
          .execute(admin);
        await sql
          .raw(`GRANT wateaminbox_worker_runtime TO ${quoteIdentifier(role)}`)
          .execute(admin);
        await sql
          .raw(`CREATE SCHEMA ${quoteIdentifier(tenantSchema)}`)
          .execute(admin);
        await sql
          .raw(
            `CREATE TABLE ${quoteIdentifier(tenantSchema)}.contacts (id uuid primary key)`,
          )
          .execute(admin);
        await sql
          .raw(
            `CREATE TABLE whatsapp_sessions.${quoteIdentifier(runtimeTable)} (id uuid primary key, value text)`,
          )
          .execute(admin);
        await sql
          .raw(
            `CREATE TABLE public.${quoteIdentifier(publicTable)} (id uuid primary key)`,
          )
          .execute(admin);
        await sql
          .raw(
            `CREATE FUNCTION public.${quoteIdentifier(hostileFunction)}() RETURNS integer LANGUAGE sql AS 'SELECT 1'`,
          )
          .execute(admin);

        const workerURL = withCredentials(
          process.env.DATABASE_URL || "",
          role,
          password,
        );
        const runtimeID = crypto.randomUUID();
        const worker = createDatabase(workerURL);
        try {
          await sql`SELECT 1 FROM whatsapp_sessions.whatsmeow_device LIMIT 1`.execute(
            worker,
          );
          await sql
            .raw(
              `INSERT INTO whatsapp_sessions.${quoteIdentifier(runtimeTable)} (id, value) VALUES (${quoteLiteral(runtimeID)}::uuid, 'ok')`,
            )
            .execute(worker);
          const runtimeRows = await sql<{ count: number }>`
            SELECT count(*)::integer AS count
            FROM whatsapp_sessions.${sql.raw(quoteIdentifier(runtimeTable))}
          `.execute(worker);
          expect(runtimeRows.rows[0]?.count).toBe(1);

          for (const hostile of [
            `SELECT * FROM public.worker_registry LIMIT 1`,
            `INSERT INTO public.worker_registry (connection_id, company_id, tenant_schema, pid, status) VALUES (gen_random_uuid(), gen_random_uuid(), 'tenant_hostile', 0, 'error')`,
            `UPDATE public.worker_upgrade_batches SET phase = 'abandoned'`,
            `DELETE FROM public.worker_upgrade_items`,
            `SELECT max_whatsapp_connections FROM public.companies LIMIT 1`,
            `SELECT * FROM public.kysely_migration LIMIT 1`,
            `SELECT * FROM ${quoteIdentifier(tenantSchema)}.contacts`,
            `INSERT INTO public.${quoteIdentifier(publicTable)} (id) VALUES (gen_random_uuid())`,
            `CREATE TABLE public.worker_escape (id integer)`,
            `SELECT public.${quoteIdentifier(hostileFunction)}()`,
          ]) {
            await expect(sql.raw(hostile).execute(worker)).rejects.toThrow();
          }
        } finally {
          await worker.destroy();
        }
      } finally {
        await admin.destroy();
      }
    },
    30_000,
  );
});

function withCredentials(databaseURL: string, user: string, password: string) {
  const url = new URL(databaseURL);
  url.username = user;
  url.password = password;
  return url.toString();
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
