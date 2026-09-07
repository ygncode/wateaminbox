import { db, getTenantSchemaName } from "@wateaminbox/database";
import { sql, type Transaction } from "kysely";
import { createLogger, formatError } from "../lib/logger.js";
import { lockActiveConnectionForEvent } from "./handlers/connection-event-guard.js";
import { deliverIncomingMessage } from "./incoming-message-delivery.service.js";
import type { TenantDatabase } from "./tenant.service.js";

export interface MessageDeliveryJob {
  company_id: string;
  connection_id: string;
  message_id: string;
  kind: "realtime" | "push";
  case_event: {
    case: { id: string; status: string };
    wasAutoReopen: boolean;
    unassignedPreviousAssignee?: string | null;
  } | null;
}

export async function enqueueMessageDelivery(
  trx: Transaction<TenantDatabase>,
  companyId: string,
  connectionId: string,
  messageId: string,
  incoming: boolean,
  caseEvent: MessageDeliveryJob["case_event"],
): Promise<void> {
  // Only identifiers and the case transition are retained. Content/media secrets
  // stay in tenant storage and current authorization is resolved on every retry.
  const transition = caseEvent
    ? {
        case: { id: caseEvent.case.id, status: caseEvent.case.status },
        wasAutoReopen: caseEvent.wasAutoReopen,
        unassignedPreviousAssignee: caseEvent.unassignedPreviousAssignee,
      }
    : null;
  for (const kind of incoming ? ["realtime", "push"] : ["realtime"]) {
    await sql`INSERT INTO public.message_delivery_outbox
      (company_id, connection_id, message_id, kind, case_event)
      VALUES (${companyId}::uuid, ${connectionId}::uuid, ${messageId}::uuid, ${kind},
        ${transition ? JSON.stringify(transition) : null}::jsonb)
      ON CONFLICT DO NOTHING`.execute(trx);
  }
}

/** Separate jobs prevent a push outage from replaying a completed realtime delivery. */
export async function dispatchMessageDelivery(
  deliver: (job: MessageDeliveryJob) => Promise<void> = deliverIncomingMessage,
  kind?: MessageDeliveryJob["kind"],
): Promise<number> {
  return db.transaction().execute(async (trx) => {
    const job = (
      await sql<MessageDeliveryJob>`SELECT company_id, connection_id, message_id, kind, case_event
      FROM public.message_delivery_outbox WHERE next_attempt_at <= statement_timestamp()
        AND (${kind ?? null}::text IS NULL OR kind = ${kind ?? null})
      ORDER BY next_attempt_at, created_at FOR UPDATE SKIP LOCKED LIMIT 1`.execute(
        trx,
      )
    ).rows[0];
    if (!job) return 0;
    const tenant = trx.withSchema(
      getTenantSchemaName(job.company_id),
    ) as unknown as Transaction<TenantDatabase>;
    const exists = (
      await sql<{ exists: boolean }>`SELECT to_regclass(
      ${`${getTenantSchemaName(job.company_id)}.whatsapp_connections`}) IS NOT NULL AS exists`.execute(
        trx,
      )
    ).rows[0]?.exists;
    if (
      exists &&
      (await lockActiveConnectionForEvent(tenant, job.connection_id))
    ) {
      try {
        await deliver(job);
      } catch (error) {
        // Commit the backoff while still owning the row, so another replica
        // cannot hot-loop the failed delivery between rollback and rescheduling.
        await sql`UPDATE public.message_delivery_outbox SET attempts = LEAST(attempts + 1, 30),
          next_attempt_at = statement_timestamp() + interval '1 second' * LEAST(300, power(2, LEAST(attempts + 1, 8)))
          WHERE company_id = ${job.company_id}::uuid AND message_id = ${job.message_id}::uuid AND kind = ${job.kind}`.execute(
          trx,
        );
        logger.warn(
          {
            err: formatError(error),
            messageId: job.message_id,
            kind: job.kind,
          },
          "Message delivery will retry",
        );
        return 1;
      }
    }
    await sql`DELETE FROM public.message_delivery_outbox
      WHERE company_id = ${job.company_id}::uuid AND message_id = ${job.message_id}::uuid AND kind = ${job.kind}`.execute(
      trx,
    );
    return 1;
  });
}

const logger = createLogger("MessageDeliveryOutbox");
// Independent bounded lanes: a push provider timeout cannot stall realtime.
const lanes = {
  realtime: {
    timer: null as ReturnType<typeof setTimeout> | null,
    running: false,
  },
  push: { timer: null as ReturnType<typeof setTimeout> | null, running: false },
};
let stopping = false;
async function poll(kind: MessageDeliveryJob["kind"]): Promise<void> {
  const lane = lanes[kind];
  if (lane.running || stopping) return;
  lane.running = true;
  let processed = 0;
  try {
    processed = await dispatchMessageDelivery(deliverIncomingMessage, kind);
  } catch (error) {
    logger.warn(
      { err: formatError(error), kind },
      "Message delivery polling failed",
    );
  } finally {
    lane.running = false;
    if (!stopping)
      lane.timer = setTimeout(() => poll(kind), processed ? 25 : 1_000);
  }
}
export function initializeMessageDelivery(): void {
  stopping = false;
  for (const kind of ["realtime", "push"] as const) {
    if (!lanes[kind].timer && !lanes[kind].running)
      lanes[kind].timer = setTimeout(() => poll(kind), 0);
  }
}
export async function shutdownMessageDelivery(): Promise<void> {
  stopping = true;
  for (const lane of Object.values(lanes)) {
    if (lane.timer) clearTimeout(lane.timer);
    lane.timer = null;
  }
  while (Object.values(lanes).some((lane) => lane.running))
    await new Promise((resolve) => setTimeout(resolve, 25));
}
