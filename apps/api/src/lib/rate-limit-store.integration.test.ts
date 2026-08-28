import { describe, expect, test } from "bun:test";
import { createDatabase } from "@wateaminbox/database";
import { sql } from "kysely";
import {
  PostgresRateLimitStore,
  RateLimitStoreUnavailableError,
} from "./rate-limit-store.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

const databaseUrl = process.env.DATABASE_URL || "";

describe("PostgreSQL rate limits across API replicas", () => {
  integrationTest(
    "atomically enforces and rolls over one shared fixed window",
    async () => {
      const firstDb = createDatabase(databaseUrl, 5);
      const secondDb = createDatabase(databaseUrl, 5);
      const first = new PostgresRateLimitStore(firstDb, 86_400, 100);
      const second = new PostgresRateLimitStore(secondDb, 86_400, 100);
      const key = `integration:${crypto.randomUUID()}`;

      try {
        const incrementAcrossReplicas = () =>
          Promise.all(
            Array.from({ length: 20 }, (_, index) =>
              (index % 2 === 0 ? first : second).increment(key, 5, 1),
            ),
          );

        const initial = await incrementAcrossReplicas();
        expect(initial.filter((result) => result.allowed)).toHaveLength(5);
        expect(Math.max(...initial.map((result) => result.currentCount))).toBe(
          6,
        );

        await new Promise((resolve) => setTimeout(resolve, 1_100));
        const rollover = await incrementAcrossReplicas();
        expect(rollover.filter((result) => result.allowed)).toHaveLength(5);
        expect(Math.max(...rollover.map((result) => result.currentCount))).toBe(
          6,
        );

        const persisted = await sql<{ request_count: string }>`
          SELECT request_count::text AS request_count
          FROM api_rate_limit_buckets
          WHERE bucket_key = ${key}
        `.execute(firstDb);
        expect(persisted.rows[0]?.request_count).toBe("6");
      } finally {
        await first.reset(key).catch(() => undefined);
        await Promise.all([first.close(), second.close()]);
        await Promise.all([firstDb.destroy(), secondDb.destroy()]);
      }
    },
    30_000,
  );

  integrationTest(
    "cleans expired rows in bounded batches and fails closed without PostgreSQL",
    async () => {
      const database = createDatabase(databaseUrl, 2);
      const store = new PostgresRateLimitStore(database, 86_400, 1);
      const expiredA = `integration:${crypto.randomUUID()}`;
      const expiredB = `integration:${crypto.randomUUID()}`;
      const live = `integration:${crypto.randomUUID()}`;

      try {
        await sql`
          INSERT INTO api_rate_limit_buckets
            (bucket_key, request_count, window_started_at, expires_at)
          VALUES
            (${expiredA}, 1, timestamptz '2000-01-01', timestamptz '2000-01-02'),
            (${expiredB}, 1, timestamptz '2000-01-01', timestamptz '2000-01-02'),
            (${live}, 1, now(), now() + interval '1 minute')
        `.execute(database);

        expect(await store.cleanupExpiredBuckets()).toBe(1);
        const remaining = await sql<{ bucket_key: string }>`
          SELECT bucket_key FROM api_rate_limit_buckets
          WHERE bucket_key IN (${expiredA}, ${expiredB}, ${live})
        `.execute(database);
        expect(remaining.rows.map((row) => row.bucket_key)).toContain(live);
        expect(remaining.rows).toHaveLength(2);
      } finally {
        await sql`
          DELETE FROM api_rate_limit_buckets
          WHERE bucket_key IN (${expiredA}, ${expiredB}, ${live})
        `
          .execute(database)
          .catch(() => undefined);
        await store.close();
        await database.destroy();
      }

      const unavailableDatabase = createDatabase(
        "postgresql://postgres:postgres@127.0.0.1:1/unavailable?connect_timeout=1",
        1,
      );
      const unavailableStore = new PostgresRateLimitStore(
        unavailableDatabase,
        86_400,
        1,
      );
      try {
        expect(
          unavailableStore.increment("unavailable", 1, 60),
        ).rejects.toBeInstanceOf(RateLimitStoreUnavailableError);
      } finally {
        await unavailableStore.close();
        await unavailableDatabase.destroy();
      }
    },
    30_000,
  );
});
