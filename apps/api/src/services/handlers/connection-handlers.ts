/**
 * Connection event handlers - QR code, connected, disconnected
 */

import { toDbDate } from "@wateaminbox/shared";
import {
  DuplicateWhatsAppPhoneError,
  WhatsAppIdentityMismatchError,
} from "../../lib/errors.js";
import { formatError } from "../../lib/logger.js";
import type {
  ConnectionEvent,
  QREvent,
  WorkerConnectionStatusEvent,
} from "../../lib/nats/index.js";
import { broadcastToCompany } from "../../lib/realtime.js";
import { enqueueSessionCommand } from "../command-outbox.service.js";
import { getTenantConnection } from "../tenant.service.js";
import {
  claimConnectedSession,
  updateConnectionStatus,
  updateSessionStatus,
} from "../whatsapp.service.js";
import { handlerLogger as logger } from "./types.js";

/**
 * Handles QR code events
 */
export async function handleQREvent(event: QREvent): Promise<void> {
  const { companyId, connectionId, sessionId } = event;

  logger.info({ companyId, connectionId }, "QR code generated");

  // Persist briefly so clients that missed the realtime event can recover QR
  // pairing by polling the normal connections endpoint.
  const tenantDb = getTenantConnection(companyId);
  if (sessionId) {
    await updateSessionStatus(tenantDb, sessionId, "pending");
  }
  await tenantDb
    .updateTable("whatsapp_connections")
    .set({
      status: "pending",
      qr_code: event.payload.qrCode,
      qr_expires_at: new Date(event.payload.expiresAt),
      updated_at: toDbDate(),
    })
    .where("id", "=", connectionId)
    .execute();

  await broadcastToCompany(companyId, "qr", event.payload, connectionId);
}

/**
 * Handles WhatsApp connection established events
 */
export async function handleConnectedEvent(
  event: ConnectionEvent,
): Promise<void> {
  const { companyId, connectionId, sessionId, payload } = event;

  logger.info(
    { companyId, connectionId, phoneNumber: payload.phoneNumber },
    "WhatsApp connected",
  );

  try {
    const tenantDb = getTenantConnection(companyId);

    let effectiveConnectionId = connectionId;
    if (sessionId && payload.phoneNumber) {
      const claimed = await claimConnectedSession(
        tenantDb,
        sessionId,
        payload.phoneNumber,
        payload.jid,
      );
      effectiveConnectionId = claimed.connectionId;
    } else {
      await updateConnectionStatus(
        tenantDb,
        "connected",
        connectionId,
        payload.phoneNumber,
        payload.jid,
      );
    }

    // Broadcast to clients with connectionId
    await broadcastToCompany(
      companyId,
      "connected",
      {
        phoneNumber: payload.phoneNumber,
        jid: payload.jid,
      },
      effectiveConnectionId,
    );
  } catch (error) {
    if (
      error instanceof DuplicateWhatsAppPhoneError ||
      error instanceof WhatsAppIdentityMismatchError
    ) {
      const isMismatch = error instanceof WhatsAppIdentityMismatchError;
      const reason = isMismatch
        ? "The scanned WhatsApp number does not match this archived account."
        : "This WhatsApp number is already linked to another connection in this workspace.";
      const tenantDb = getTenantConnection(companyId);
      if (sessionId) {
        await tenantDb.transaction().execute(async (trx) => {
          await enqueueSessionCommand(trx, companyId, sessionId, (publisher) =>
            publisher.kill("duplicate phone pairing rejected", true),
          );
          await updateSessionStatus(
            trx,
            sessionId,
            "ended",
            "duplicate phone pairing rejected",
          );
          await trx
            .updateTable("whatsapp_connections")
            .set({
              status: "disconnected",
              qr_code: null,
              qr_expires_at: null,
              archived_at: toDbDate(),
              updated_at: toDbDate(),
            })
            .where("id", "=", connectionId)
            .execute();
        });
      }
      await broadcastToCompany(
        companyId,
        "disconnected",
        {
          reason,
          code: isMismatch ? "identity_mismatch" : "duplicate_phone",
        },
        connectionId,
      );
      await broadcastToCompany(
        companyId,
        "notification:toast",
        {
          type: "error",
          title: isMismatch ? "Wrong WhatsApp number" : "Number already linked",
          message: reason,
        },
        connectionId,
      );
      logger.warn(
        {
          companyId,
          connectionId,
          ...(error instanceof DuplicateWhatsAppPhoneError
            ? { existingConnectionId: error.existingConnectionId }
            : {
                expectedPhoneNumber: error.expectedPhoneNumber,
                actualPhoneNumber: error.actualPhoneNumber,
              }),
        },
        "Rejected duplicate WhatsApp phone connection",
      );
      return;
    }
    logger.error(formatError(error), "Failed to handle connected event");
    throw error;
  }
}

/**
 * Handles WhatsApp disconnection events
 */
export async function handleDisconnectedEvent(
  event: ConnectionEvent,
): Promise<void> {
  const { companyId, connectionId, sessionId, payload } = event;

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
    if (sessionId) {
      await updateSessionStatus(tenantDb, sessionId, "disconnected");
    }

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
    throw error;
  }
}

/**
 * Handles worker connection status events from orchestrator
 * Called when worker crashes, exceeds max restart attempts, or recovers
 */
export async function handleWorkerConnectionStatusEvent(
  event: WorkerConnectionStatusEvent,
): Promise<void> {
  const { companyId, connectionId, sessionId, payload } = event;

  logger.info(
    { companyId, connectionId, status: payload.status, reason: payload.reason },
    "Worker connection status changed",
  );

  try {
    const tenantDb = getTenantConnection(companyId);

    // Worker lifecycle names are broader than the persisted connection enum.
    // Never write transient control-plane states (stopped/connecting) directly.
    const dbStatus =
      payload.status === "connected"
        ? "connected"
        : payload.status === "connecting"
          ? "pending"
          : "disconnected";

    if (sessionId) {
      await updateSessionStatus(
        tenantDb,
        sessionId,
        dbStatus === "connected"
          ? "connected"
          : dbStatus === "pending"
            ? "connecting"
            : "disconnected",
      );
    }

    await tenantDb
      .updateTable("whatsapp_connections")
      .set({
        status: dbStatus,
        ...(dbStatus === "connected"
          ? { qr_code: null, qr_expires_at: null }
          : {}),
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
    throw error;
  }
}
