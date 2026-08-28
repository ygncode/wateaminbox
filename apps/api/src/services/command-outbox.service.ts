import { db } from "@wateaminbox/database";
import { toDbDate } from "@wateaminbox/shared";
import { type Kysely, sql, type Transaction } from "kysely";
import { createLogger, formatError } from "../lib/logger.js";
import {
  forConnection,
  type NatsCommandPublisher,
} from "../lib/nats/command-builder.js";
import {
  buildCommandSubject,
  type NatsCommand,
  publishOutboxCommand,
} from "../lib/nats/index.js";
import { broadcastToCompany } from "../lib/realtime.js";
import { getTenantConnection, type TenantDatabase } from "./tenant.service.js";
import { getActiveSessionId } from "./whatsapp/session.js";

const logger = createLogger("CommandOutbox");
const POLL_INTERVAL_MS = 1_000;
const BATCH_SIZE = 25;
const MAX_ATTEMPTS = 10;
const CLAIM_LEASE_MS = 30_000;

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let stopping = false;
let lastPollAt: Date | null = null;
let lastPublishLatencyMs: number | null = null;
let publishedTotal = 0;
let failedTotal = 0;

export function getCommandOutboxHealth() {
  return {
    initialized: timer !== null || running,
    running,
    stopping,
    lastPollAt,
    lastPublishLatencyMs,
    publishedTotal,
    failedTotal,
  };
}

export type CommandOutboxBacklog = {
  pending: number;
  oldestPendingAt: Date | null;
};

/**
 * The backlog scan costs one query per active tenant, so it must never run
 * once per caller. `/health/ready` is unauthenticated, which would otherwise
 * turn a cheap probe into an arbitrary-cost fan-out across every tenant
 * schema. Results are memoized for a probe interval, and concurrent callers
 * share a single in-flight computation.
 */
const BACKLOG_CACHE_TTL_MS = 10_000;
let backlogCache: { value: CommandOutboxBacklog; expiresAt: number } | null =
  null;
let backlogInFlight: Promise<CommandOutboxBacklog> | null = null;

async function computeCommandOutboxBacklog(): Promise<CommandOutboxBacklog> {
  const companies = await db
    .selectFrom("companies")
    .select("id")
    .where("status", "=", "active")
    .execute();
  let pending = 0;
  let oldestPendingAt: Date | null = null;

  for (const company of companies) {
    const summary = await getTenantConnection(company.id)
      .selectFrom("nats_outbox")
      .select(({ fn }) => [
        fn.count<number>("id").as("count"),
        fn.min<Date>("created_at").as("oldest"),
      ])
      .where("status", "in", ["pending", "claimed"])
      .executeTakeFirst();
    pending += Number(summary?.count ?? 0);
    if (
      summary?.oldest &&
      (!oldestPendingAt || summary.oldest < oldestPendingAt)
    ) {
      oldestPendingAt = summary.oldest;
    }
  }
  return { pending, oldestPendingAt };
}

export async function getCommandOutboxBacklog(
  load: () => Promise<CommandOutboxBacklog> = computeCommandOutboxBacklog,
): Promise<CommandOutboxBacklog> {
  const now = Date.now();
  if (backlogCache && backlogCache.expiresAt > now) return backlogCache.value;
  if (backlogInFlight) return backlogInFlight;

  backlogInFlight = load()
    .then((value) => {
      backlogCache = { value, expiresAt: Date.now() + BACKLOG_CACHE_TTL_MS };
      return value;
    })
    .finally(() => {
      // A failure must not be cached: the next probe should retry.
      backlogInFlight = null;
    });

  return backlogInFlight;
}

/** Drop the memoized backlog so tests observe fresh reads. */
export function resetCommandOutboxBacklogCache(): void {
  backlogCache = null;
  backlogInFlight = null;
}

export type TenantDbExecutor =
  | Kysely<TenantDatabase>
  | Transaction<TenantDatabase>;

export function prepareOutboxPayload(
  payload: Record<string, unknown>,
  id: string,
): Record<string, unknown> {
  return { ...payload, command_id: id };
}

export async function enqueueCommand(
  executor: TenantDbExecutor,
  subject: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const id = crypto.randomUUID();
  const databaseNow = sql<Date>`statement_timestamp()`;
  await executor
    .insertInto("nats_outbox")
    .values({
      id,
      subject,
      payload: prepareOutboxPayload(payload, id),
      status: "pending",
      attempts: 0,
      next_attempt_at: databaseNow,
      created_at: databaseNow,
    })
    .execute();
  return id;
}

export async function enqueueConnectionCommand(
  executor: TenantDbExecutor,
  companyId: string,
  connectionId: string,
  build: (publisher: NatsCommandPublisher) => Promise<void>,
): Promise<void> {
  const sessionId = await getActiveSessionId(executor, connectionId);
  await enqueueSessionCommand(executor, companyId, sessionId, build);
}

export async function enqueueSessionCommand(
  executor: TenantDbExecutor,
  companyId: string,
  sessionId: string,
  build: (publisher: NatsCommandPublisher) => Promise<void>,
): Promise<void> {
  const publisher = forConnection(
    companyId,
    sessionId,
    async (subject, command: NatsCommand) => {
      await enqueueCommand(
        executor,
        subject,
        command as unknown as Record<string, unknown>,
      );
    },
    buildCommandSubject,
  );
  await build(publisher);
}

export function getOutboxRetryDelayMs(attempts: number): number {
  return Math.min(60_000, 1_000 * 2 ** Math.min(attempts, 6));
}

export type OutboxPublisher = (
  subject: string,
  payload: NatsCommand | Record<string, unknown>,
  outboxId: string,
) => Promise<void>;

export async function dispatchCompany(
  companyId: string,
  publish: OutboxPublisher = (subject, payload, outboxId) =>
    publishOutboxCommand(subject, payload, outboxId),
): Promise<number> {
  const tenantDb = getTenantConnection(companyId);
  const databaseNow = sql<Date>`statement_timestamp()`;
  const nextLease = sql<Date>`date_trunc(
    'milliseconds',
    statement_timestamp() + (${CLAIM_LEASE_MS} * interval '1 millisecond')
  )`;

  // Claim under a short transaction, then publish after committing so network
  // latency never holds row locks or a PostgreSQL connection transaction open.
  // Database time avoids replica clock skew; millisecond truncation keeps the
  // returned timestamp usable as an exact lease-fencing token through pg Date.
  const rows = await tenantDb.transaction().execute(async (trx) => {
    const claimed = await trx
      .selectFrom("nats_outbox")
      .select(["id", "subject", "payload", "attempts"])
      .where((eb) =>
        eb.or([
          eb.and([
            eb("status", "=", "pending"),
            eb("next_attempt_at", "<=", databaseNow),
          ]),
          eb.and([
            eb("status", "=", "claimed"),
            eb("next_attempt_at", "<=", databaseNow),
          ]),
        ]),
      )
      .orderBy("created_at", "asc")
      .limit(BATCH_SIZE)
      .forUpdate()
      .skipLocked()
      .execute();

    if (claimed.length === 0) return [];
    const leases = await trx
      .updateTable("nats_outbox")
      .set({ status: "claimed", next_attempt_at: nextLease })
      .where(
        "id",
        "in",
        claimed.map((row) => row.id),
      )
      .returning(["id", "next_attempt_at"])
      .execute();
    const leaseById = new Map(
      leases.map((lease) => [lease.id, lease.next_attempt_at]),
    );
    return claimed.flatMap((row) => {
      const claimUntil = leaseById.get(row.id);
      return claimUntil ? [{ ...row, claimUntil }] : [];
    });
  });

  for (const row of rows) {
    // A batch is published serially to preserve command ordering. Renew each
    // row immediately before its network call so later rows cannot expire just
    // because earlier publications consumed most of the original batch lease.
    const refreshedClaim = await tenantDb
      .updateTable("nats_outbox")
      .set({ next_attempt_at: nextLease })
      .where("id", "=", row.id)
      .where("status", "=", "claimed")
      .where("next_attempt_at", "=", row.claimUntil)
      .returning("next_attempt_at")
      .executeTakeFirst();
    if (!refreshedClaim) continue;
    const claimUntil = refreshedClaim.next_attempt_at;

    const startedAt = performance.now();
    let publishFailure: { error: unknown } | undefined;
    try {
      await publish(row.subject, row.payload, row.id);
      lastPublishLatencyMs = performance.now() - startedAt;
    } catch (error) {
      publishFailure = { error };
    }

    if (!publishFailure) {
      try {
        const result = await tenantDb
          .updateTable("nats_outbox")
          .set({
            status: "published",
            attempts: row.attempts + 1,
            last_error: null,
            published_at: toDbDate(),
          })
          .where("id", "=", row.id)
          .where("status", "=", "claimed")
          // next_attempt_at is both the lease deadline and the claim token. A
          // dispatcher that outlived its lease must not finish a newer claim.
          .where("next_attempt_at", "=", claimUntil)
          .executeTakeFirst();
        if (result.numUpdatedRows > 0n) publishedTotal++;
      } catch (error) {
        // The broker accepted this command. Never reinterpret a persistence
        // failure as a publish failure: leave the row leased for an idempotent
        // replay under its stable JetStream message ID.
        logger.error(
          { companyId, outboxId: row.id, err: formatError(error) },
          "Published outbox command but could not persist its outcome",
        );
      }
      continue;
    }

    const error = publishFailure.error;
    const attempts = row.attempts + 1;
    const exhausted = attempts >= MAX_ATTEMPTS;
    const result = await tenantDb
      .updateTable("nats_outbox")
      .set({
        status: exhausted ? "failed" : "pending",
        attempts,
        last_error:
          error instanceof Error
            ? error.message.slice(0, 2_000)
            : String(error),
        next_attempt_at: sql<Date>`statement_timestamp() + (
          ${getOutboxRetryDelayMs(attempts)} * interval '1 millisecond'
        )`,
      })
      .where("id", "=", row.id)
      .where("status", "=", "claimed")
      .where("next_attempt_at", "=", claimUntil)
      .executeTakeFirst();
    const claimWasCurrent = result.numUpdatedRows > 0n;

    logger.warn(
      {
        companyId,
        outboxId: row.id,
        attempts,
        exhausted,
        claimWasCurrent,
        err: formatError(error),
      },
      "Failed to publish outbox command",
    );
    if (exhausted && claimWasCurrent) {
      failedTotal++;
      const failure = {
        commandId: row.id,
        commandType: String(row.payload.type || "unknown"),
        success: false,
        error: "Unable to deliver command to WhatsApp services",
      };
      const pendingMessageId =
        typeof row.payload.message_id === "string"
          ? row.payload.message_id
          : undefined;
      if (pendingMessageId) {
        await tenantDb
          .updateTable("messages")
          .set({ status: "failed" })
          .where("message_id", "=", pendingMessageId)
          .where("status", "=", "pending")
          .execute();
      }
      await Promise.all([
        broadcastToCompany(companyId, "command:failed", failure),
        broadcastToCompany(companyId, "notification:toast", {
          type: "error",
          title: "WhatsApp action failed",
          message: failure.error,
        }),
      ]);
    }
  }

  return rows.length;
}

export async function dispatchPendingCommands(): Promise<number> {
  const companies = await db
    .selectFrom("companies")
    .select("id")
    .where("status", "=", "active")
    .execute();

  let processed = 0;
  for (const company of companies) {
    try {
      processed += await dispatchCompany(company.id);
    } catch (error) {
      logger.error(
        { companyId: company.id, err: formatError(error) },
        "Failed to dispatch company outbox",
      );
    }
  }
  return processed;
}

async function poll(): Promise<void> {
  if (running || stopping) return;
  running = true;
  lastPollAt = new Date();
  try {
    await dispatchPendingCommands();
  } catch (error) {
    logger.error({ err: formatError(error) }, "Outbox polling failed");
  } finally {
    running = false;
    if (!stopping) timer = setTimeout(poll, POLL_INTERVAL_MS);
  }
}

export function initializeCommandOutbox(): void {
  if (timer || running) return;
  stopping = false;
  timer = setTimeout(poll, 0);
  logger.info("Command outbox dispatcher initialized");
}

export async function shutdownCommandOutbox(): Promise<void> {
  stopping = true;
  if (timer) clearTimeout(timer);
  timer = null;
  while (running) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  logger.info("Command outbox dispatcher stopped");
}
