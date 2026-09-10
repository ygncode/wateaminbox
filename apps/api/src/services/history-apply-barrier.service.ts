import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import { createLogger } from "../lib/logger.js";
import { parseWhatsAppEvent } from "../lib/nats/client.js";
import type { WhatsAppEvent } from "../lib/nats/types/base.js";

const logger = createLogger("HistoryApplyBarrier");
let timer: ReturnType<typeof setTimeout> | undefined;
let pending: Promise<void> | undefined;
let stopped = true;

export function isHistoryBarrier(event: WhatsAppEvent): boolean {
  return (
    event.type === "history_sync_page" ||
    (event.type === "sync_status" &&
      (event.payload as { status?: string }).status === "completed")
  );
}

export async function canApplyHistoryBarrier(
  event: WhatsAppEvent,
): Promise<boolean> {
  if (!event.eventId || !isHistoryBarrier(event)) return true;
  // The drain can snapshot a marker payload and then race with the critical
  // loop, which applies + deletes that same row via `acknowledgeAppliedHistory`.
  // Once the row is gone the JOIN finds no `marker`, so `waiting` alone would be
  // `false` and a second consumer would re-apply an *already applied* marker,
  // broadcasting a duplicate `history:loaded`. Requiring the marker row to still
  // `exists` turns "deleted by another consumer" into "already applied": the
  // critical loop (row present while applying) and the drain share this one
  // gate, so the loser of the delete race returns false and skips the duplicate.
  const result = await sql<{ exists: boolean; waiting: boolean }>`
    SELECT
      EXISTS (
        SELECT 1 FROM whatsapp_sessions.worker_event_outbox
        WHERE connection_id = ${event.connectionId}::uuid
          AND event_id = ${event.eventId}::uuid
      ) AS exists,
      EXISTS (
        SELECT 1 FROM whatsapp_sessions.worker_event_outbox AS marker
        JOIN whatsapp_sessions.worker_event_outbox AS earlier
          ON earlier.connection_id = marker.connection_id AND earlier.event_order < marker.event_order
        WHERE marker.connection_id = ${event.connectionId}::uuid AND marker.event_id = ${event.eventId}::uuid
          AND split_part(earlier.subject, '.', 5) IN ('history_message', 'history_contact')
      ) AS waiting
  `.execute(db);
  const { exists, waiting } = result.rows[0];
  return exists && !waiting;
}

export async function acknowledgeAppliedHistory(
  event: WhatsAppEvent,
): Promise<void> {
  if (!event.eventId) return;
  if (
    event.type !== "sync_status" &&
    event.type !== "history_sync_page" &&
    event.type !== "contact" &&
    !(
      event.type === "message" &&
      (event.payload as { isHistorySync?: boolean }).isHistorySync
    )
  )
    return;
  await sql`DELETE FROM whatsapp_sessions.worker_event_outbox
    WHERE connection_id = ${event.connectionId}::uuid AND event_id = ${event.eventId}::uuid
      AND split_part(subject, '.', 3) = ${event.companyId}`.execute(db);
}

// Broker delivery of a completion marker can precede database application on
// another consumer/replica. Leave that marker durable and acknowledge transport;
// polling avoids blocking the live event loop or exhausting NATS redeliveries.
export async function drainHistoryBarriers(
  apply: (event: WhatsAppEvent) => Promise<void>,
): Promise<void> {
  const result = await sql<{ payload: Buffer }>`SELECT marker.payload
    FROM whatsapp_sessions.worker_event_outbox AS marker
    WHERE marker.published_at IS NOT NULL
      AND split_part(marker.subject, '.', 5) IN ('sync_status', 'history_sync_page')
      AND NOT EXISTS (
        SELECT 1 FROM whatsapp_sessions.worker_event_outbox AS earlier
        WHERE earlier.connection_id = marker.connection_id AND earlier.event_order < marker.event_order
          AND split_part(earlier.subject, '.', 5) IN ('history_message', 'history_contact')
      )
    ORDER BY marker.event_order LIMIT 100`.execute(db);
  for (const row of result.rows) {
    try {
      await apply(parseWhatsAppEvent(JSON.parse(row.payload.toString("utf8"))));
    } catch (error) {
      logger.error(
        { err: error },
        "Deferred history marker application failed",
      );
    }
  }
}

export function startHistoryBarrierDrain(
  apply: (event: WhatsAppEvent) => Promise<void>,
): void {
  if (!stopped) return;
  stopped = false;
  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      pending = drainHistoryBarriers(apply)
        .catch((error) => {
          logger.error({ err: error }, "History barrier drain failed");
        })
        .finally(schedule);
    }, 1_000);
    // Like shutdown.ts's own deadline timer, the drain must never itself be
    // the reason the process stays alive: shutdown stops it explicitly via
    // stopHistoryBarrierDrain, and process.exit is the escape hatch for
    // anything abandoned rather than cancelled.
    timer.unref?.();
  };
  schedule();
}

export async function stopHistoryBarrierDrain(): Promise<void> {
  stopped = true;
  clearTimeout(timer);
  await pending;
}
