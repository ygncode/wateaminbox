import { db } from "@wateaminbox/database";
import { toDbDate } from "@wateaminbox/shared";
import type { Kysely, Transaction } from "kysely";
import { createLogger, formatError } from "../lib/logger.js";
import { broadcastToCompany } from "../lib/pusher.js";
import {
  buildCommandSubject,
  type NatsCommand,
  publishOutboxCommand,
} from "../lib/nats/index.js";
import {
  forConnection,
  type NatsCommandPublisher,
} from "../lib/nats/command-builder.js";
import {
  getTenantConnection,
  type TenantDatabase,
} from "./tenant.service.js";

const logger = createLogger("CommandOutbox");
const POLL_INTERVAL_MS = 1_000;
const BATCH_SIZE = 25;
const MAX_ATTEMPTS = 10;

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let stopping = false;

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
  await executor
    .insertInto("nats_outbox")
    .values({
      id,
      subject,
      payload: prepareOutboxPayload(payload, id),
      status: "pending",
      attempts: 0,
      next_attempt_at: toDbDate(),
      created_at: toDbDate(),
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
  const publisher = forConnection(
    companyId,
    connectionId,
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

async function dispatchCompany(companyId: string): Promise<number> {
  const tenantDb = getTenantConnection(companyId);

  return tenantDb.transaction().execute(async (trx) => {
    const rows = await trx
      .selectFrom("nats_outbox")
      .select(["id", "subject", "payload", "attempts"])
      .where("status", "=", "pending")
      .where("next_attempt_at", "<=", toDbDate())
      .orderBy("created_at", "asc")
      .limit(BATCH_SIZE)
      .forUpdate()
      .skipLocked()
      .execute();

    for (const row of rows) {
      try {
        await publishOutboxCommand(row.subject, row.payload, row.id);
        await trx
          .updateTable("nats_outbox")
          .set({
            status: "published",
            attempts: row.attempts + 1,
            last_error: null,
            published_at: toDbDate(),
          })
          .where("id", "=", row.id)
          .execute();
      } catch (error) {
        const attempts = row.attempts + 1;
        const exhausted = attempts >= MAX_ATTEMPTS;
        await trx
          .updateTable("nats_outbox")
          .set({
            status: exhausted ? "failed" : "pending",
            attempts,
            last_error:
              error instanceof Error ? error.message.slice(0, 2_000) : String(error),
            next_attempt_at: new Date(
              Date.now() + getOutboxRetryDelayMs(attempts),
            ),
          })
          .where("id", "=", row.id)
          .execute();

        logger.warn(
          {
            companyId,
            outboxId: row.id,
            attempts,
            exhausted,
            err: formatError(error),
          },
          "Failed to publish outbox command",
        );
        if (exhausted) {
          const failure = {
            commandId: row.id,
            commandType: String(row.payload.type || "unknown"),
            success: false,
            error: "Unable to deliver command to WhatsApp services",
          };
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
    }

    return rows.length;
  });
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
