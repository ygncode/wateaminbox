import { db } from "@wateaminbox/database";
import { toDbDate } from "@wateaminbox/shared";
import { type Kysely, sql } from "kysely";
import { createLogger, formatError } from "../lib/logger.js";
import { broadcastToCompany } from "../lib/realtime.js";
import {
  enqueuePairedSessionStop,
  PAIRED_SESSION_STOP_POLICIES,
} from "./handlers/connection-handlers.js";
import { getTenantConnection, type TenantDatabase } from "./tenant.service.js";
import { updateSessionStatus } from "./whatsapp/session.js";

const logger = createLogger("AbandonedPairingSessions");

const CYCLE_INTERVAL_MS = 60_000;

/**
 * How long an unscanned setup attempt is left alone before it is closed.
 *
 * whatsmeow issues a batch of six codes about twenty seconds apart, so a live
 * attempt is finished within roughly two minutes and the worker reports
 * `qr_timeout`. This is deliberately far above that: the worker's own report is
 * the primary path, and this exists only for the attempts that never produce
 * one, so it can afford to be slow and certain rather than race a user who is
 * reaching for their phone.
 */
const ABANDONED_AFTER_MS = 15 * 60_000;

/** Bounds one tenant's share of a cycle, as the sibling sweepers do. */
const PER_CYCLE_LIMIT = 25;

const END_REASON = "QR pairing expired without a scan";

let timer: ReturnType<typeof setInterval> | null = null;
let inFlight: Promise<void> | null = null;
let stopping = false;

type ClaimedSession = {
  id: string;
  whatsapp_connection_id: string;
};

/**
 * Close setup attempts that were never scanned and whose worker never said so.
 *
 * `handleDisconnectedEvent` already ends an attempt the moment the worker
 * reports `qr_timeout`, and that covers the ordinary case. It cannot cover a
 * worker that dies before reporting: the attempt then keeps `ended_at` null, so
 * it still reads as the connection's active session, and any worker left behind
 * holds one of the fleet's connection slots with no paired device.
 *
 * Both API replicas run this cycle, so each candidate is claimed inside one
 * transaction with `FOR UPDATE SKIP LOCKED` and its predicates re-checked under
 * that lock. Ending a session is not idempotent -- `updateSessionStatus` with
 * "ended" deliberately does not guard on `ended_at` -- so without the claim the
 * replicas would both end the row and enqueue two kills.
 */
export async function reapAbandonedPairingSessions(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
  options: {
    limit?: number;
    shouldStop?: () => boolean;
    abandonedAfterMs?: number;
  } = {},
): Promise<number> {
  const abandonedAfterMs = options.abandonedAfterMs ?? ABANDONED_AFTER_MS;
  let reaped = 0;

  for (let i = 0; i < (options.limit ?? PER_CYCLE_LIMIT); i++) {
    if (options.shouldStop?.()) break;

    const claimed: ClaimedSession | null = await tenantDb
      .transaction()
      .execute(async (trx) => {
        const session = await trx
          .selectFrom("whatsapp_connection_sessions")
          .select(["id", "whatsapp_connection_id"])
          // Never scanned, never closed, and old enough that no one is still
          // looking at the code.
          .where("connected_at", "is", null)
          .where("ended_at", "is", null)
          .where(
            "started_at",
            "<",
            sql<Date>`now() - ${abandonedAfterMs} * interval '1 millisecond'`,
          )
          // A connection that is serving traffic is never disturbed by this
          // sweep. Someone can abandon a re-pair on an account that is still
          // connected through its previous session, and closing that account
          // over an abandoned attempt would be a self-inflicted outage.
          .where((eb) =>
            eb.exists(
              eb
                .selectFrom("whatsapp_connections")
                .select("id")
                .whereRef(
                  "whatsapp_connections.id",
                  "=",
                  "whatsapp_connection_sessions.whatsapp_connection_id",
                )
                .where("status", "!=", "connected"),
            ),
          )
          .orderBy("started_at")
          .forUpdate()
          .skipLocked()
          .limit(1)
          .executeTakeFirst();
        if (!session) return null;

        await updateSessionStatus(trx, session.id, "ended", END_REASON);
        await trx
          .updateTable("whatsapp_connections")
          .set({
            status: "disconnected",
            qr_code: null,
            qr_expires_at: null,
            updated_at: toDbDate(),
          })
          .where("id", "=", session.whatsapp_connection_id)
          .where("status", "!=", "connected")
          .execute();
        // Enqueued unconditionally. Most reaped attempts have no worker left,
        // which is the gap this covers, and the orchestrator answers a kill for
        // a connection it has no durable row for through its idempotent local
        // path rather than as an error.
        await enqueuePairedSessionStop(
          trx,
          companyId,
          session.id,
          END_REASON,
          PAIRED_SESSION_STOP_POLICIES.qrExpired,
        );
        return session;
      });

    if (!claimed) break;
    reaped++;
    logger.info(
      {
        companyId,
        sessionId: claimed.id,
        connectionId: claimed.whatsapp_connection_id,
      },
      "Closed an abandoned pairing session",
    );

    // After commit, and without the toast the worker-reported path raises. That
    // one interrupts someone watching their code expire; this one is cleaning up
    // an attempt abandoned a quarter of an hour ago, and an error toast for it
    // is noise. The event still refreshes an open connections page.
    await broadcastToCompany(
      companyId,
      "disconnected",
      { reason: END_REASON, code: "qr_timeout" },
      claimed.whatsapp_connection_id,
    );
  }

  return reaped;
}

async function executeCycle(): Promise<void> {
  const companies = await db
    .selectFrom("companies")
    .select("id")
    .where("status", "=", "active")
    .execute();
  for (const company of companies) {
    if (stopping) return;
    try {
      await reapAbandonedPairingSessions(
        getTenantConnection(company.id),
        company.id,
        { shouldStop: () => stopping },
      );
    } catch (error) {
      logger.error(
        { companyId: company.id, err: formatError(error) },
        "Abandoned pairing session sweep failed",
      );
    }
  }
}

export function initializeAbandonedPairingSessions(): void {
  if (timer) return;
  stopping = false;
  const run = () => {
    if (inFlight || stopping) return;
    inFlight = executeCycle()
      .catch((error) => {
        logger.error(
          { err: formatError(error) },
          "Abandoned pairing session cycle failed",
        );
      })
      .finally(() => {
        inFlight = null;
      });
  };
  run();
  timer = setInterval(run, CYCLE_INTERVAL_MS);
}

export async function shutdownAbandonedPairingSessions(): Promise<void> {
  stopping = true;
  if (timer) clearInterval(timer);
  timer = null;
  await inFlight;
}
