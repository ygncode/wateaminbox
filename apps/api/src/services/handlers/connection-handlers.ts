/**
 * Connection event handlers - QR code, connected, disconnected
 */

import type {
  QREvent,
  ConnectionEvent,
  WorkerConnectionStatusEvent,
} from "../../lib/nats/index.js";
import { toDbDate } from "@wateaminbox/shared";
import { getTenantConnection } from "../tenant.service.js";
import { updateConnectionStatus } from "../whatsapp.service.js";
import { broadcastToCompany } from "../../lib/pusher.js";
import { formatError } from "../../lib/logger.js";
import { handlerLogger as logger } from "./types.js";

/**
 * Handles QR code events
 */
export async function handleQREvent(event: QREvent): Promise<void> {
  const { companyId, connectionId } = event;

  // Just log for monitoring
  logger.info({ companyId, connectionId }, "QR code generated");

  // Broadcast to connected clients with connectionId
  await broadcastToCompany(companyId, "qr", event.payload, connectionId);
}

/**
 * Handles WhatsApp connection established events
 */
export async function handleConnectedEvent(
  event: ConnectionEvent,
): Promise<void> {
  const { companyId, connectionId, payload } = event;

  logger.info(
    { companyId, connectionId, phoneNumber: payload.phoneNumber },
    "WhatsApp connected",
  );

  try {
    const tenantDb = getTenantConnection(companyId);

    // Update connection status in database with connectionId
    await updateConnectionStatus(
      tenantDb,
      "connected",
      connectionId,
      payload.phoneNumber,
      payload.jid,
    );

    // Broadcast to clients with connectionId
    await broadcastToCompany(
      companyId,
      "connected",
      {
        phoneNumber: payload.phoneNumber,
        jid: payload.jid,
      },
      connectionId,
    );
  } catch (error) {
    logger.error(formatError(error), "Failed to handle connected event");
  }
}

/**
 * Handles WhatsApp disconnection events
 */
export async function handleDisconnectedEvent(
  event: ConnectionEvent,
): Promise<void> {
  const { companyId, connectionId, payload } = event;

  logger.info(
    { companyId, connectionId, reason: payload.reason },
    "WhatsApp disconnected",
  );

  try {
    const tenantDb = getTenantConnection(companyId);

    // Check if sync was in progress before disconnection
    const connection = await tenantDb
      .selectFrom("whatsapp_connections")
      .select(["sync_status"])
      .where("id", "=", connectionId)
      .executeTakeFirst();

    const wasSyncing = connection?.sync_status === "syncing";

    // Update connection status in database with connectionId
    await updateConnectionStatus(tenantDb, "disconnected", connectionId);

    // If sync was interrupted, update sync_status to "interrupted"
    if (wasSyncing) {
      await tenantDb
        .updateTable("whatsapp_connections")
        .set({
          sync_status: "interrupted",
          updated_at: toDbDate(),
        })
        .where("id", "=", connectionId)
        .execute();

      logger.info(
        { connectionId },
        "History sync was interrupted by disconnection",
      );

      // Broadcast sync interrupted event
      await broadcastToCompany(
        companyId,
        "sync:interrupted",
        { reason: payload.reason },
        connectionId,
      );
    }

    // Broadcast to clients with connectionId
    await broadcastToCompany(
      companyId,
      "disconnected",
      { reason: payload.reason },
      connectionId,
    );
  } catch (error) {
    logger.error(formatError(error), "Failed to handle disconnected event");
  }
}

/**
 * Handles worker connection status events from orchestrator
 * Called when worker crashes, exceeds max restart attempts, or recovers
 */
export async function handleWorkerConnectionStatusEvent(
  event: WorkerConnectionStatusEvent,
): Promise<void> {
  const { companyId, connectionId, payload } = event;

  logger.info(
    { companyId, connectionId, status: payload.status, reason: payload.reason },
    "Worker connection status changed",
  );

  try {
    const tenantDb = getTenantConnection(companyId);

    // Update connection status in database based on worker status
    // "error" and "failed" map to "disconnected" in DB
    const dbStatus =
      payload.status === "error" || payload.status === "failed"
        ? "disconnected"
        : payload.status;

    await tenantDb
      .updateTable("whatsapp_connections")
      .set({
        status: dbStatus,
        updated_at: toDbDate(),
      })
      .where("id", "=", connectionId)
      .execute();

    // Broadcast connection:status event to clients
    // Frontend will show toast and disable message input
    await broadcastToCompany(
      companyId,
      "connection:status",
      {
        status: payload.status,
        reason: payload.reason,
      },
      connectionId,
    );

    // Also broadcast a toast notification for user visibility
    if (payload.status === "error" || payload.status === "failed") {
      await broadcastToCompany(
        companyId,
        "notification:toast",
        {
          type: "error",
          title: "WhatsApp disconnected",
          message: payload.reason || "Connection lost unexpectedly",
        },
        connectionId,
      );
    }
  } catch (error) {
    logger.error(
      formatError(error),
      "Failed to handle worker connection status event",
    );
  }
}
