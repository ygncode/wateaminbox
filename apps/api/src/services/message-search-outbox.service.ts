import { getTenantSchemaName } from "@wateaminbox/database";
import { getContactDisplayName } from "@wateaminbox/shared";
import { Kysely, PostgresDialect, sql, type Transaction } from "kysely";
import { Pool } from "pg";
import { env } from "../lib/env.js";
import { createLogger, formatError } from "../lib/logger.js";
import { lockActiveConnectionForEvent } from "./handlers/connection-event-guard.js";
import {
  getMessagesIndex,
  type MessageDocument,
} from "./meilisearch.service.js";
import type { TenantDatabase } from "./tenant.service.js";

// A slow search service may occupy this ONE background connection per replica,
// never the HTTP/event tenant pool. Keep this slot in deployment DB budgets.
const searchDb = new Kysely<TenantDatabase>({
  dialect: new PostgresDialect({
    pool: new Pool({
      connectionString: env.DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    }),
  }),
});
const logger = createLogger("MessageSearchOutbox");
let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let stopping = false;
let lastPollAt: Date | null = null;
let completedTotal = 0;
let failedTotal = 0;

export function getMessageSearchHealth() {
  return {
    initialized: timer !== null || running,
    running,
    lastPollAt,
    completedTotal,
    failedTotal,
  };
}

export async function enqueueMessageSearch(
  trx: Transaction<TenantDatabase>,
  companyId: string,
  connectionId: string,
  messageId: string,
): Promise<void> {
  await sql`INSERT INTO public.message_search_outbox (company_id, message_id, connection_id)
    VALUES (${companyId}::uuid, ${messageId}::uuid, ${connectionId}::uuid)
    ON CONFLICT DO NOTHING`.execute(trx);
}

type Job = { company_id: string; message_id: string; connection_id: string };
type Submit = (
  companyId: string,
  documents: MessageDocument[],
) => Promise<void>;

async function submit(
  companyId: string,
  documents: MessageDocument[],
): Promise<void> {
  const index = await getMessagesIndex(companyId);
  // Wait for actual success, not merely task acceptance. Failed tasks remain
  // durable retry work instead of silently leaving messages unsearchable.
  const task = await index.addDocuments(documents).waitTask({ timeout: 5_000 });
  if (task.status !== "succeeded")
    throw new Error("Message indexing task failed");
}

export async function dispatchMessageSearch(
  publish: Submit = submit,
): Promise<number> {
  let jobs: Job[] = [];
  try {
    return await searchDb.transaction().execute(async (trx) => {
      // One connection per batch preserves the purge lock order and lets us
      // batch Meilisearch submissions without holding many lifecycle locks.
      const first = (
        await sql<Job>`SELECT company_id, message_id, connection_id
        FROM public.message_search_outbox WHERE next_attempt_at <= statement_timestamp()
        ORDER BY next_attempt_at, created_at FOR UPDATE SKIP LOCKED LIMIT 1`.execute(
          trx,
        )
      ).rows[0];
      if (!first) return 0;
      jobs = (
        await sql<Job>`SELECT company_id, message_id, connection_id
        FROM public.message_search_outbox WHERE company_id = ${first.company_id}::uuid
          AND connection_id = ${first.connection_id}::uuid AND next_attempt_at <= statement_timestamp()
        ORDER BY next_attempt_at, created_at FOR UPDATE SKIP LOCKED LIMIT 25`.execute(
          trx,
        )
      ).rows;
      const tenant = trx.withSchema(getTenantSchemaName(first.company_id));
      const exists = (
        await sql<{ exists: boolean }>`SELECT to_regclass(
        ${`${getTenantSchemaName(first.company_id)}.whatsapp_connections`}) IS NOT NULL AS exists`.execute(
          trx,
        )
      ).rows[0]?.exists;
      if (
        exists &&
        (await lockActiveConnectionForEvent(tenant, first.connection_id))
      ) {
        const rows = await tenant
          .selectFrom("messages as m")
          .innerJoin("contacts as c", "c.id", "m.contact_id")
          .select([
            "m.id",
            "m.message_id",
            "c.id as contact_id",
            "m.content",
            "m.message_type",
            "m.timestamp",
            "m.from_me",
            "c.push_name",
            "c.username",
            "c.custom_name",
            "c.jid",
            "c.is_group",
          ])
          .where(
            "m.id",
            "in",
            jobs.map((job) => job.message_id),
          )
          .where("m.whatsapp_connection_id", "=", first.connection_id)
          .execute();
        const documents: MessageDocument[] = rows.map((row) => ({
          id: row.id,
          companyId: first.company_id,
          contactId: row.contact_id,
          contactName: getContactDisplayName(row, "Unknown"),
          contactJid: row.jid,
          isGroup: row.is_group || Boolean(row.jid?.includes("@g.us")),
          messageId: row.message_id,
          content: row.content,
          messageType: row.message_type,
          timestamp: Math.floor(new Date(row.timestamp).getTime() / 1000),
          fromMe: row.from_me,
        }));
        if (documents.length) await publish(first.company_id, documents);
      }
      // The same transaction owns the lifecycle lock through submission and
      // completion. Purge cannot enqueue deletion before this add; a crash
      // rolls back the jobs and retries against current rows after recovery.
      await sql`DELETE FROM public.message_search_outbox WHERE company_id = ${first.company_id}::uuid
        AND message_id IN (${sql.join(jobs.map((job) => sql`${job.message_id}::uuid`))})`.execute(
        trx,
      );
      completedTotal += jobs.length;
      return jobs.length;
    });
  } catch (error) {
    failedTotal += jobs.length;
    for (const job of jobs) {
      await sql`UPDATE public.message_search_outbox SET attempts = LEAST(attempts + 1, 30),
        next_attempt_at = statement_timestamp() + interval '1 second' * LEAST(300, power(2, LEAST(attempts + 1, 8)))
        WHERE company_id = ${job.company_id}::uuid AND message_id = ${job.message_id}::uuid`.execute(
        searchDb,
      );
    }
    throw error;
  }
}

async function poll() {
  if (running || stopping) return;
  running = true;
  lastPollAt = new Date();
  let processed = 0;
  try {
    processed = await dispatchMessageSearch();
  } catch (error) {
    logger.warn({ err: formatError(error) }, "Search indexing will retry");
  } finally {
    running = false;
    if (!stopping) timer = setTimeout(poll, processed > 0 ? 25 : 1_000);
  }
}

export function initializeMessageSearch() {
  if (timer || running) return;
  stopping = false;
  timer = setTimeout(poll, 0);
}

export async function shutdownMessageSearch() {
  stopping = true;
  if (timer) clearTimeout(timer);
  timer = null;
  while (running) await new Promise((resolve) => setTimeout(resolve, 25));
  await searchDb.destroy();
}
