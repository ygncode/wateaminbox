import { describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { createDatabase } from "./client.js";
import { down, up } from "./migrations/076_add_api_rate_limit_buckets.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

type ColumnRow = {
  column_name: string;
  data_type: string;
  is_nullable: "YES" | "NO";
};

describe("rate-limit migration 076", () => {
  integrationTest(
    "creates the shared counter contract and its expiration index",
    async () => {
      const database = createDatabase(process.env.DATABASE_URL || "");
      const schema = `migration_${crypto.randomUUID().replaceAll("-", "_")}`;

      try {
        await sql.raw(`CREATE SCHEMA "${schema}"`).execute(database);
        await database.transaction().execute(async (transaction) => {
          await sql
            .raw(`SET LOCAL search_path TO "${schema}"`)
            .execute(transaction);
          const migrationDb = transaction as unknown as Kysely<unknown>;
          await up(migrationDb);

          const columns = await sql<ColumnRow>`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema = ${schema}
              AND table_name = 'api_rate_limit_buckets'
            ORDER BY ordinal_position
          `.execute(transaction);
          expect(columns.rows).toEqual([
            { column_name: "bucket_key", data_type: "text", is_nullable: "NO" },
            {
              column_name: "request_count",
              data_type: "bigint",
              is_nullable: "NO",
            },
            {
              column_name: "window_started_at",
              data_type: "timestamp with time zone",
              is_nullable: "NO",
            },
            {
              column_name: "expires_at",
              data_type: "timestamp with time zone",
              is_nullable: "NO",
            },
          ]);

          const indexes = await sql<{ indexname: string }>`
            SELECT indexname
            FROM pg_indexes
            WHERE schemaname = ${schema}
              AND tablename = 'api_rate_limit_buckets'
          `.execute(transaction);
          expect(indexes.rows.map((row) => row.indexname)).toContain(
            "api_rate_limit_buckets_expires_at_idx",
          );

          const constraints = await sql<{ definition: string }>`
            SELECT pg_get_constraintdef(constraint_row.oid) AS definition
            FROM pg_constraint AS constraint_row
            JOIN pg_class AS table_row
              ON table_row.oid = constraint_row.conrelid
            JOIN pg_namespace AS namespace_row
              ON namespace_row.oid = table_row.relnamespace
            WHERE namespace_row.nspname = ${schema}
              AND table_row.relname = 'api_rate_limit_buckets'
              AND constraint_row.contype = 'c'
          `.execute(transaction);
          expect(
            constraints.rows.map((row) => row.definition).join(" "),
          ).toContain("request_count >= 1");

          await down(migrationDb);
          const table = await sql<{ table_name: string | null }>`
            SELECT to_regclass(${`${schema}.api_rate_limit_buckets`})::text AS table_name
          `.execute(transaction);
          expect(table.rows[0]?.table_name).toBeNull();
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
