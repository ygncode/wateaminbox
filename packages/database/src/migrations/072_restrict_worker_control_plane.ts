import { type Kysely, sql } from "kysely";

const workerRole = "wateaminbox_worker_runtime";

/**
 * Establish the shared, least-privilege worker database role. Login credentials
 * are provisioned separately from Docker secrets; migrations never contain a
 * password. Per-connection RLS is intentionally a later security program.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(`
    DO $block$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${workerRole}') THEN
        CREATE ROLE ${workerRole} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
      END IF;
    END
    $block$
  `)
    .execute(db);

  await sql
    .raw(
      `GRANT CONNECT ON DATABASE ${quoteIdentifier(await currentDatabase(db))} TO ${workerRole}`,
    )
    .execute(db);
  await sql
    .raw(`REVOKE CREATE ON SCHEMA public FROM PUBLIC, ${workerRole}`)
    .execute(db);
  await sql
    .raw(`GRANT USAGE ON SCHEMA whatsapp_sessions TO ${workerRole}`)
    .execute(db);

  // PUBLIC table access is unnecessary in this single-application database and
  // would make a role-level deny impossible because PostgreSQL grants are
  // additive. Owners retain all privileges.
  await sql`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC`.execute(db);
  await sql`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC`.execute(
    db,
  );
  await sql`REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC`.execute(
    db,
  );

  await sql
    .raw(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA whatsapp_sessions TO ${workerRole}`,
    )
    .execute(db);
  await sql
    .raw(
      `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA whatsapp_sessions TO ${workerRole}`,
    )
    .execute(db);
  await sql
    .raw(
      `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA whatsapp_sessions FROM PUBLIC, ${workerRole}`,
    )
    .execute(db);

  await sql
    .raw(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, ${workerRole}`,
    )
    .execute(db);
  await sql
    .raw(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, ${workerRole}`,
    )
    .execute(db);
  // Function EXECUTE is a global PUBLIC default applied before per-schema
  // defaults, so it must be revoked without IN SCHEMA.
  await sql
    .raw(
      `ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, ${workerRole}`,
    )
    .execute(db);
  await sql
    .raw(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA whatsapp_sessions GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${workerRole}`,
    )
    .execute(db);
  await sql
    .raw(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA whatsapp_sessions GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${workerRole}`,
    )
    .execute(db);
  await sql
    .raw(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA whatsapp_sessions REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, ${workerRole}`,
    )
    .execute(db);

  // Existing and future tenant schemas are data-plane authority owned by the
  // API, not by the shared worker role. Keep that boundary explicit even as new
  // tenant schemas are created dynamically.
  await sql
    .raw(`
    DO $block$
    DECLARE tenant record;
    BEGIN
      FOR tenant IN SELECT nspname FROM pg_namespace WHERE nspname LIKE 'tenant\\_%' ESCAPE '\\'
      LOOP
        EXECUTE format('REVOKE ALL ON SCHEMA %I FROM ${workerRole}', tenant.nspname);
        EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM ${workerRole}', tenant.nspname);
        EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM ${workerRole}', tenant.nspname);
        EXECUTE format('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA %I FROM PUBLIC, ${workerRole}', tenant.nspname);
      END LOOP;
    END
    $block$
  `)
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`GRANT CREATE ON SCHEMA public TO PUBLIC`.execute(db);
  await sql`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO PUBLIC`.execute(
    db,
  );
  await sql
    .raw(`ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO PUBLIC`)
    .execute(db);
  await sql
    .raw(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA whatsapp_sessions REVOKE ALL ON TABLES FROM ${workerRole}`,
    )
    .execute(db);
  await sql
    .raw(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA whatsapp_sessions REVOKE ALL ON SEQUENCES FROM ${workerRole}`,
    )
    .execute(db);
  await sql
    .raw(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM ${workerRole}`,
    )
    .execute(db);
  await sql
    .raw(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM ${workerRole}`,
    )
    .execute(db);
  await sql
    .raw(
      `REVOKE ALL ON ALL TABLES IN SCHEMA whatsapp_sessions FROM ${workerRole}`,
    )
    .execute(db);
  await sql
    .raw(
      `REVOKE ALL ON ALL SEQUENCES IN SCHEMA whatsapp_sessions FROM ${workerRole}`,
    )
    .execute(db);
  await sql
    .raw(`REVOKE ALL ON SCHEMA whatsapp_sessions FROM ${workerRole}`)
    .execute(db);
  await sql
    .raw(
      `REVOKE ALL ON DATABASE ${quoteIdentifier(await currentDatabase(db))} FROM ${workerRole}`,
    )
    .execute(db);
  await sql.raw(`DROP ROLE IF EXISTS ${workerRole}`).execute(db);
}

async function currentDatabase(db: Kysely<unknown>): Promise<string> {
  const result = await sql<{
    name: string;
  }>`SELECT current_database() AS name`.execute(db);
  const name = result.rows[0]?.name;
  if (!name) throw new Error("current database is unavailable");
  return name;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
