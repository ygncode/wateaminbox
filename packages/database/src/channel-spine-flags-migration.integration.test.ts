import { expect, test } from "bun:test";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import {
  down,
  up,
} from "./migrations/090_add_channel_spine_workspace_flags.js";

const integration = process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

integration(
  "channel spine flags are legacy-safe, revisioned, audited, and private",
  async () => {
    const adminUrl = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1"].includes(adminUrl.hostname)) {
      throw new Error("Local test database required");
    }
    const databaseName = `channel_spine_flags_${crypto.randomUUID().replaceAll("-", "")}`;
    const connect = (url: URL) =>
      new Kysely<unknown>({
        dialect: new PostgresDialect({
          pool: new Pool({ connectionString: url.toString(), max: 1 }),
        }),
      });
    const admin = connect(adminUrl);
    await sql`CREATE DATABASE ${sql.id(databaseName)}`.execute(admin);
    const testUrl = new URL(adminUrl);
    testUrl.pathname = `/${databaseName}`;
    const database = connect(testUrl);
    const companyId = crypto.randomUUID();
    const actorId = crypto.randomUUID();

    try {
      await sql`CREATE TABLE public.companies (id UUID PRIMARY KEY)`.execute(
        database,
      );
      await sql`CREATE TABLE public.users (id UUID PRIMARY KEY)`.execute(
        database,
      );
      await sql`INSERT INTO public.companies (id) VALUES (${companyId}::uuid)`.execute(
        database,
      );
      await sql`INSERT INTO public.users (id) VALUES (${actorId}::uuid)`.execute(
        database,
      );
      await database.transaction().execute(up);

      const noRows = await sql<{ count: string }>`SELECT count(*)::text AS count
      FROM public.channel_spine_workspace_flags`.execute(database);
      expect(noRows.rows[0]?.count).toBe("0");

      await sql`INSERT INTO public.channel_spine_workspace_flags
      (company_id, created_by, updated_by)
      VALUES (${companyId}::uuid, ${actorId}::uuid, ${actorId}::uuid)`.execute(
        database,
      );
      const initial = await sql<{
        dual_write_enabled: boolean;
        neutral_reads_enabled: boolean;
        write_authority: string;
        enabled_providers: string[];
        revision: string;
      }>`SELECT dual_write_enabled, neutral_reads_enabled, write_authority,
        enabled_providers, revision
      FROM public.channel_spine_workspace_flags
      WHERE company_id = ${companyId}::uuid`.execute(database);
      expect(initial.rows[0]).toMatchObject({
        dual_write_enabled: false,
        neutral_reads_enabled: false,
        write_authority: "legacy",
        enabled_providers: [],
        revision: "1",
      });

      await expect(
        sql`UPDATE public.channel_spine_workspace_flags
      SET neutral_reads_enabled = true, revision = 2
      WHERE company_id = ${companyId}::uuid`.execute(database),
      ).rejects.toThrow();

      await sql`UPDATE public.channel_spine_workspace_flags
      SET neutral_reads_enabled = true,
          neutral_read_revision = 'api-test-revision',
          revision = 2,
          updated_by = ${actorId}::uuid
      WHERE company_id = ${companyId}::uuid`.execute(database);
      const audit = await sql<{
        revision: string;
        changed_by: string;
        previous_flags: unknown | null;
      }>`SELECT revision, changed_by, previous_flags
      FROM public.channel_spine_workspace_flag_audit
      WHERE company_id = ${companyId}::uuid
      ORDER BY revision`.execute(database);
      expect(audit.rows).toHaveLength(2);
      expect(audit.rows.map((row) => row.revision)).toEqual(["1", "2"]);
      expect(audit.rows[1]?.changed_by).toBe(actorId);
      expect(audit.rows[0]?.previous_flags).toBeNull();
      expect(audit.rows[1]?.previous_flags).not.toBeNull();

      const publicGrants = await sql<{
        count: string;
      }>`SELECT count(*)::text AS count
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name IN ('channel_spine_workspace_flags', 'channel_spine_workspace_flag_audit')
        AND grantee = 'PUBLIC'`.execute(database);
      expect(publicGrants.rows[0]?.count).toBe("0");
      await database.transaction().execute(down);
    } finally {
      await database.destroy();
      await sql`DROP DATABASE ${sql.id(databaseName)}`.execute(admin);
      await admin.destroy();
    }
  },
  120_000,
);
