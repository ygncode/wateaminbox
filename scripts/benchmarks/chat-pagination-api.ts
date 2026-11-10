/** Local-only synthetic benchmark. See docs/performance/chat-pagination.md. */
import { performance } from "node:perf_hooks";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const databaseUrl = new URL(process.env.DATABASE_URL ?? "http://unset.invalid");
if (
  process.env.RUN_CHAT_PAGINATION_BENCHMARK !== "1" ||
  !["postgres:", "postgresql:"].includes(databaseUrl.protocol) ||
  !["localhost", "127.0.0.1"].includes(databaseUrl.hostname) ||
  databaseUrl.port !== "4447" ||
  databaseUrl.pathname !== "/wateaminbox"
) {
  throw new Error(
    "Opt in with RUN_CHAT_PAGINATION_BENCHMARK=1 and the local localhost:4447/wateaminbox database",
  );
}
process.env.RATE_LIMIT_ENABLED = "false";
await import("../../apps/api/src/test-env");
const { db, reconcileChannelSpineConcurrentIndexes } = await import(
  "@wateaminbox/database"
);
const { sql, CompiledQuery } = await import("kysely");
const { DEFAULT_SLA_WEEKLY_SCHEDULE } = await import("@wateaminbox/shared");
const { app } = await import("../../apps/api/src/app");
const { hashPassword } = await import("../../apps/api/src/lib/password");
const {
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
  clearTenantConnection,
  shutdownTenantConnections,
} = await import("../../apps/api/src/services/tenant.service");
const { getContactsWithLastMessage } = await import(
  "../../apps/api/src/services/contact.service"
);

const sizes = (process.env.BENCH_SIZES ?? "1000,10000,25000")
  .split(",")
  .map(Number);
const samples = Number(process.env.BENCH_SAMPLES ?? "20");
const burstRepeats = Number(process.env.BENCH_BURST_REPEATS ?? "1");
if (
  sizes.some(
    (size, i) =>
      !Number.isSafeInteger(size) ||
      size < 100 ||
      size > 50000 ||
      (i > 0 && size <= sizes[i - 1]),
  ) ||
  !Number.isSafeInteger(samples) ||
  samples < 3 ||
  samples > 100 ||
  !Number.isSafeInteger(burstRepeats) ||
  burstRepeats < 1 ||
  burstRepeats > 10
) {
  throw new Error(
    "Use increasing sizes from 100 to 50000, 3–100 samples, and 1–10 bursts",
  );
}
const companyId = crypto.randomUUID();
const userId = crypto.randomUUID();
const schemaName = getSchemaName(companyId);
const waAccount = crypto.randomUUID();
const channelAccount = crypto.randomUUID();
const tagId = crypto.randomUUID();
const tenantDb = getTenantConnection(companyId);
const table = (name: string) => sql.table(`${schemaName}.${name}`);
const password = crypto.randomUUID();
const email = `pagination-bench-${userId}@example.invalid`;
const results: Record<string, unknown>[] = [];
const plans: Record<string, unknown>[] = [];

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number) =>
    +sorted[Math.ceil(sorted.length * p) - 1].toFixed(2);
  return {
    samples: values.length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: percentile(1),
  };
}

try {
  await db
    .insertInto("users")
    .values({
      id: userId,
      email,
      password_hash: await hashPassword(password),
      email_verified_at: new Date(),
    })
    .execute();
  await db
    .insertInto("companies")
    .values({
      id: companyId,
      name: "Synthetic pagination benchmark",
      schema_name: schemaName,
      status: "active",
    })
    .execute();
  await db
    .insertInto("company_members")
    .values({ company_id: companyId, user_id: userId, role: "owner" })
    .execute();
  await db
    .insertInto("sla_policies")
    .values({
      company_id: companyId,
      target_minutes: 60,
      direct_resolution_target_minutes: 480,
      group_response_target_minutes: 120,
      group_resolution_target_minutes: 960,
      timezone: "UTC",
      weekly_schedule: JSON.stringify(DEFAULT_SLA_WEEKLY_SCHEDULE),
      exceptions: "[]",
      effective_from: new Date("1970-01-01"),
      created_by: userId,
    })
    .execute();
  await db
    .insertInto("channel_spine_workspace_flags")
    .values({
      company_id: companyId,
      neutral_reads_enabled: true,
      neutral_read_revision: "synthetic-benchmark",
      revision: "1",
      created_by: userId,
      updated_by: userId,
    })
    .execute();
  await createTenantSchema(companyId);
  await reconcileChannelSpineConcurrentIndexes(db, schemaName);
  await tenantDb
    .insertInto("whatsapp_connections")
    .values({ id: waAccount, name: "Synthetic WhatsApp", status: "connected" })
    .execute();
  await tenantDb
    .insertInto("channel_accounts")
    .values([
      {
        id: waAccount,
        channel: "whatsapp",
        provider: "whatsapp_linked_device",
        legacy_whatsapp_connection_id: waAccount,
        external_account_id: "synthetic-wa",
        external_scope_id: "synthetic",
        status: "connected",
      },
      {
        id: channelAccount,
        channel: "telegram",
        provider: "telegram_bot",
        external_account_id: "synthetic-tg",
        external_scope_id: "synthetic",
        status: "connected",
      },
    ])
    .execute();
  await tenantDb
    .insertInto("tags")
    .values({ id: tagId, name: "Synthetic tag" })
    .execute();
  const login = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (login.status !== 200)
    throw new Error(`Benchmark login failed: ${login.status}`);
  const { tokens } = (await login.json()) as {
    tokens: { accessToken: string };
  };
  const headers = {
    authorization: `Bearer ${tokens.accessToken}`,
    "x-company-id": companyId,
  };
  async function request(path: string) {
    const started = performance.now();
    const response = await app.request(`/api/${path}`, { headers });
    const text = await response.text();
    if (response.status !== 200)
      throw new Error(`Benchmark endpoint failed: ${response.status}`);
    const body = JSON.parse(text);
    return {
      ms: performance.now() - started,
      bytes: Buffer.byteLength(text),
      rows: body.data.length,
    };
  }

  let previous = 0;
  for (const size of sizes) {
    console.log(
      `Seeding synthetic size=${size} (${size * 10} WhatsApp messages, ${size} channel threads)`,
    );
    await sql`INSERT INTO ${table("contacts")} (id, whatsapp_connection_id, jid, phone_number, push_name, is_group)
      SELECT md5('contact-' || g)::uuid, ${waAccount}::uuid, g::text || '@s.whatsapp.net', '650' || lpad(g::text, 8, '0'), 'Synthetic ' || lpad(g::text, 6, '0'), g % 10 = 0
      FROM generate_series(${previous + 1}::int, ${size}::int) g`.execute(
      tenantDb,
    );
    await sql`INSERT INTO ${table("conversations")} (id, channel_account_id, legacy_contact_id, external_thread_id, client_thread_key, kind, last_message_at)
      SELECT md5('wa-' || g)::uuid, ${waAccount}::uuid, md5('contact-' || g)::uuid, g::text, 'wa:' || g, 'direct', '2026-01-01'::timestamptz - g * interval '1 minute'
      FROM generate_series(${previous + 1}::int, ${size}::int) g`.execute(
      tenantDb,
    );
    await sql`INSERT INTO ${table("conversations")} (id, channel_account_id, external_thread_id, client_thread_key, kind, subject, last_message_at)
      SELECT md5('tg-' || g)::uuid, ${channelAccount}::uuid, g::text, 'tg:' || g, 'direct', 'Synthetic channel ' || g, '2026-01-01'::timestamptz - g * interval '1 minute'
      FROM generate_series(${previous + 1}::int, ${size}::int) g`.execute(
      tenantDb,
    );
    await sql`INSERT INTO ${table("messages")} (id, whatsapp_connection_id, contact_id, conversation_id, message_id, from_me, message_type, content, status, timestamp)
      SELECT md5(g || '-' || m)::uuid, ${waAccount}::uuid, md5('contact-' || g)::uuid, md5('wa-' || g)::uuid, 'synthetic-' || g || '-' || m, false, 'text', repeat('Synthetic benchmark preview. ', 4), 'delivered', '2026-01-01'::timestamptz - g * interval '1 minute' - m * interval '1 second'
      FROM generate_series(${previous + 1}::int, ${size}::int) g CROSS JOIN generate_series(1, 10) m`.execute(
      tenantDb,
    );
    await sql`INSERT INTO ${table("conversation_states")} (contact_id, conversation_id, status, unread_count, last_message_at, last_message_preview)
      SELECT legacy_contact_id, id, 'resolved', 0, last_message_at, 'Synthetic benchmark preview'
      FROM ${table("conversations")} WHERE id NOT IN (SELECT conversation_id FROM ${table("conversation_states")} WHERE conversation_id IS NOT NULL)`.execute(
      tenantDb,
    );
    await sql`INSERT INTO ${table("contact_tags")} (contact_id, tag_id)
      SELECT md5('contact-' || g)::uuid, ${tagId}::uuid FROM generate_series(${previous + 1}::int, ${size}::int) g WHERE g % 10 = 0`.execute(
      tenantDb,
    );
    // Only the oldest ten conversations per source are unread. This exercises
    // filtering before pagination without changing the main All-view dataset.
    await sql`UPDATE ${table("conversation_states")} SET unread_count = 0 WHERE unread_count > 0`.execute(
      tenantDb,
    );
    await sql`UPDATE ${table("conversation_states")} SET unread_count = 1
      WHERE conversation_id IN (
        SELECT md5(prefix || g)::uuid
        FROM generate_series(${size - 9}::int, ${size}::int) g
        CROSS JOIN (VALUES ('wa-'), ('tg-')) AS source(prefix)
      )`.execute(tenantDb);
    // Statistics and all supported indexes are in place before measurements.
    for (const name of [
      "contacts",
      "conversations",
      "messages",
      "conversation_states",
      "contact_tags",
      "channel_accounts",
      "contact_assignments",
      "conversation_participants",
    ]) {
      await sql`ANALYZE ${table(name)}`.execute(tenantDb);
    }
    previous = size;

    if (process.env.BENCH_DIAGNOSTIC_ONLY !== "1") {
      for (const offset of [0, Math.floor(size / 2), size - 100]) {
        for (const endpoint of ["contacts", "conversations"]) {
          const path = `${endpoint}?limit=100&offset=${offset}&includeGroups=true&conversationStatus=all`;
          const first = await request(path);
          for (let i = 0; i < 2; i++) await request(path);
          const times: number[] = [];
          for (let i = 0; i < samples; i++)
            times.push((await request(path)).ms);
          const result = {
            size,
            endpoint,
            offset,
            firstObservedMs: +first.ms.toFixed(2),
            responseBytes: first.bytes,
            rows: first.rows,
            ...stats(times),
          };
          results.push(result);
          console.log(`RESULT ${JSON.stringify(result)}`);
        }
      }
      for (const [name, suffix] of [
        ["tag-10-percent", `tagIds=${tagId}`],
        ["exact-name-search", "search=Synthetic%20000500"],
        ["empty-status", "conversationStatus=open"],
        ["sparse-unread", "unreadOnly=true"],
      ]) {
        const path = `contacts?limit=100&offset=0&includeGroups=true&${suffix}`;
        const first = await request(path);
        const times = [];
        for (let i = 0; i < samples; i++) times.push((await request(path)).ms);
        const result = {
          size,
          endpoint: "contacts",
          filter: name,
          rows: first.rows,
          responseBytes: first.bytes,
          ...stats(times),
        };
        results.push(result);
        console.log(`RESULT ${JSON.stringify(result)}`);
      }
      for (let iteration = 0; iteration < burstRepeats; iteration++) {
        const burst = await Promise.all(
          Array.from({ length: 10 }, () =>
            request(
              "contacts?limit=100&includeGroups=true&conversationStatus=all",
            ),
          ),
        );
        const burstResult = {
          size,
          endpoint: "contacts",
          concurrency: 10,
          burst: iteration + 1,
          ...stats(burst.map((value) => value.ms)),
        };
        results.push(burstResult);
        console.log(`RESULT ${JSON.stringify(burstResult)}`);
      }
    }

    // Capture the exact production service SQL, not a simplified stand-in.
    for (const offset of [0, size - 100]) {
      const queries: ReturnType<typeof CompiledQuery.raw>[] = [];
      const jitDisabledQueries = new Set<number>();
      let readsHaveJitDisabled = false;
      const capturedDb = tenantDb.withPlugin({
        transformQuery({ node, queryId }) {
          const compiled = tenantDb.getExecutor().compileQuery(node, queryId);
          if (/^\s*SET LOCAL jit\s*=\s*off/i.test(compiled.sql)) {
            readsHaveJitDisabled = true;
          } else if (/^\s*(SELECT|WITH)\b/i.test(compiled.sql)) {
            if (readsHaveJitDisabled) jitDisabledQueries.add(queries.length);
            queries.push(compiled);
          }
          return node;
        },
        async transformResult({ result }) {
          return result;
        },
      });
      await getContactsWithLastMessage(capturedDb, companyId, {
        includeGroups: true,
        conversationStatus: "all",
        limit: 100,
        offset,
      });
      for (const [index, query] of queries.entries()) {
        const modes =
          process.env.BENCH_DIAGNOSTIC_ONLY === "1"
            ? ["server-default", "jit-off"]
            : ["production"];
        for (const mode of modes) {
          await tenantDb.transaction().execute(async (transaction) => {
            // Transaction-local diagnostic only; never change server configuration.
            if (
              mode === "jit-off" ||
              (mode === "production" && jitDisabledQueries.has(index))
            )
              await sql`SET LOCAL jit = off`.execute(transaction);
            const times: number[] = [];
            const repeats =
              process.env.BENCH_DIAGNOSTIC_ONLY === "1" ? samples : 1;
            for (let repetition = 0; repetition < repeats; repetition++) {
              const explained = await transaction.executeQuery<{
                "QUERY PLAN": { "Execution Time": number }[];
              }>(
                CompiledQuery.raw(
                  `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.sql}`,
                  [...query.parameters],
                ),
              );
              times.push(explained.rows[0]["QUERY PLAN"][0]["Execution Time"]);
              if (repetition === repeats - 1) {
                // No actual customer data or credentials enter the plans.
                plans.push({
                  size,
                  offset,
                  query: index === 0 ? "rows" : "count",
                  mode,
                  plan: explained.rows,
                });
              }
            }
            if (process.env.BENCH_DIAGNOSTIC_ONLY === "1") {
              const diagnostic = {
                size,
                offset,
                query: index === 0 ? "rows" : "count",
                mode,
                ...stats(times),
              };
              results.push(diagnostic);
              console.log(`DIAGNOSTIC ${JSON.stringify(diagnostic)}`);
            }
          });
        }
      }
    }
  }
} finally {
  // Only UUID-owned fixtures created by this process are removed; never a reset.
  await clearTenantConnection(companyId);
  await sql`DROP SCHEMA IF EXISTS ${sql.ref(schemaName)} CASCADE`.execute(db);
  await db
    .deleteFrom("sla_policies")
    .where("company_id", "=", companyId)
    .execute();
  await db
    .deleteFrom("company_members")
    .where("company_id", "=", companyId)
    .execute();
  await db.deleteFrom("companies").where("id", "=", companyId).execute();
  await db.deleteFrom("users").where("id", "=", userId).execute();
  await shutdownTenantConnections();
  await db.destroy();
}
const output = process.env.BENCH_OUTPUT ?? "/tmp/chat-pagination-api.json";
await mkdir(dirname(output), { recursive: true });
await Bun.write(
  output,
  JSON.stringify(
    {
      environment:
        "local synthetic; in-process Hono requests, PostgreSQL over localhost Docker; no HTTP RTT or avatar signing",
      sizes,
      messagesPerContact: 10,
      results,
      plans,
    },
    null,
    2,
  ),
);
console.log(
  `Saved synthetic benchmark results to ${output}; fixtures removed.`,
);
