/**
 * Connection event handlers - QR code, connected, disconnected
 */

import { toDbDate } from "@wateaminbox/shared";
import type { Kysely } from "kysely";
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
import { admitConnectedPhone } from "../connection-admission.service.js";
import { getTenantConnection, type TenantDatabase } from "../tenant.service.js";
import {
  claimConnectedSession,
  normalizeWhatsAppPhone,
  updateConnectionStatus,
  updateSessionStatus,
} from "../whatsapp.service.js";
import { handlerLogger as logger } from "./types.js";

type ConnectedSessionSnapshot = {
  session_ended_at: Date | null;
  stable_connection_id: string;
  established_phone_number: string | null;
  connection_archived_at: Date | null;
};

export function isEstablishedReconnect(
  prior: ConnectedSessionSnapshot | undefined,
  connectionId: string,
  phoneNumber: string,
): boolean {
  return Boolean(
    prior &&
      prior.session_ended_at === null &&
      prior.connection_archived_at === null &&
      prior.stable_connection_id === connectionId &&
      prior.established_phone_number !== null &&
      normalizeWhatsAppPhone(prior.established_phone_number) ===
        normalizeWhatsAppPhone(phoneNumber),
  );
}

export const PAIRED_SESSION_STOP_POLICIES = {
  admissionUnavailable: { unlink: false, endSession: false, archive: false },
  admissionRejected: { unlink: true, endSession: true, archive: false },
  identityRejected: { unlink: true, endSession: true, archive: true },
} as const;

type PairedSessionStopPolicy =
  (typeof PAIRED_SESSION_STOP_POLICIES)[keyof typeof PAIRED_SESSION_STOP_POLICIES];

export async function enqueuePairedSessionStop(
  executor: Parameters<typeof enqueueSessionCommand>[0],
  companyId: string,
  sessionId: string,
  commandReason: string,
  policy: PairedSessionStopPolicy,
  enqueue: typeof enqueueSessionCommand = enqueueSessionCommand,
): Promise<void> {
  await enqueue(executor, companyId, sessionId, (publisher) =>
    publisher.kill(commandReason, policy.unlink),
  );
}

export type PairedSessionStopInput = {
  companyId: string;
  connectionId: string;
  sessionId: string;
  reason: string;
  code: string;
  title: string;
  commandReason: string;
  policy: PairedSessionStopPolicy;
};

async function stopPairedSession(input: PairedSessionStopInput): Promise<void> {
  const tenantDb = getTenantConnection(input.companyId);
  await tenantDb.transaction().execute(async (trx) => {
    await enqueuePairedSessionStop(
      trx,
      input.companyId,
      input.sessionId,
      input.commandReason,
      input.policy,
    );
    await updateSessionStatus(
      trx,
      input.sessionId,
      input.policy.endSession ? "ended" : "disconnected",
      input.commandReason,
    );
    await trx
      .updateTable("whatsapp_connections")
      .set({
        status: "disconnected",
        qr_code: null,
        qr_expires_at: null,
        ...(input.policy.archive ? { archived_at: toDbDate() } : {}),
        updated_at: toDbDate(),
      })
      .where("id", "=", input.connectionId)
      .execute();
  });
  await broadcastToCompany(
    input.companyId,
    "disconnected",
    { reason: input.reason, code: input.code },
    input.connectionId,
  );
  await broadcastToCompany(
    input.companyId,
    "notification:toast",
    { type: "error", title: input.title, message: input.reason },
    input.connectionId,
  );
}

type ConnectedEventDependencies = {
  getTenantConnection?: typeof getTenantConnection;
  admitConnectedPhone?: typeof admitConnectedPhone;
  stopPairedSession?: typeof stopPairedSession;
};

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
  dependencies: ConnectedEventDependencies = {},
): Promise<void> {
  const { companyId, connectionId, sessionId, payload } = event;

  logger.info({ companyId, connectionId }, "WhatsApp connected");

  try {
    const tenantDb = (dependencies.getTenantConnection ?? getTenantConnection)(
      companyId,
    );

    let effectiveConnectionId = connectionId;
    if (sessionId && payload.phoneNumber) {
      const prior = await tenantDb
        .selectFrom("whatsapp_connection_sessions as session")
        .innerJoin(
          "whatsapp_connections as connection",
          "connection.id",
          "session.whatsapp_connection_id",
        )
        .select([
          "session.ended_at as session_ended_at",
          "session.whatsapp_connection_id as stable_connection_id",
          "connection.phone_number as established_phone_number",
          "connection.archived_at as connection_archived_at",
        ])
        .where("session.id", "=", sessionId)
        .executeTakeFirst();
      const establishedReconnect = isEstablishedReconnect(
        prior,
        connectionId,
        payload.phoneNumber,
      );

      if (establishedReconnect) {
        // A process restart of an already-established session consumes no new
        // entitlement and must not depend on the commercial admission service.
        // Treating it like a fresh pairing caused a transient control-plane
        // outage to send an unlink command and permanently revoke live devices.
        await updateSessionStatus(tenantDb, sessionId, "connected");
        await updateConnectionStatus(
          tenantDb,
          "connected",
          connectionId,
          payload.phoneNumber,
          payload.jid,
        );
      } else {
        let admission;
        try {
          admission = await (
            dependencies.admitConnectedPhone ?? admitConnectedPhone
          )({
            companyId,
            phoneNumber: payload.phoneNumber,
          });
        } catch (error) {
          const reason =
            "We could not verify connection eligibility. The connection was paused without unlinking; retry when the service is available.";
          await (dependencies.stopPairedSession ?? stopPairedSession)({
            companyId,
            connectionId,
            sessionId,
            reason,
            code: "admission_unavailable",
            title: "Connection check unavailable",
            commandReason: "connection admission unavailable",
            policy: PAIRED_SESSION_STOP_POLICIES.admissionUnavailable,
          });
          logger.error(
            { companyId, connectionId, error: formatError(error) },
            "Connection admission unavailable; worker stopped without unlinking",
          );
          return;
        }
        if (!admission.allowed) {
          await (dependencies.stopPairedSession ?? stopPairedSession)({
            companyId,
            connectionId,
            sessionId,
            reason: admission.message,
            code: admission.paymentRequired
              ? "payment_required"
              : admission.code,
            title: admission.paymentRequired
              ? "Upgrade required"
              : "Connection denied",
            commandReason: "connection admission rejected",
            policy: PAIRED_SESSION_STOP_POLICIES.admissionRejected,
          });
          logger.warn(
            { companyId, connectionId, code: admission.code },
            "Rejected WhatsApp connection by admission policy",
          );
          return;
        }
        const claimed = await claimConnectedSession(
          tenantDb,
          sessionId,
          payload.phoneNumber,
          payload.jid,
        );
        effectiveConnectionId = claimed.connectionId;
      }
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
      if (sessionId) {
        await stopPairedSession({
          companyId,
          connectionId,
          sessionId,
          reason,
          code: isMismatch ? "identity_mismatch" : "duplicate_phone",
          title: isMismatch ? "Wrong WhatsApp number" : "Number already linked",
          commandReason: "duplicate phone pairing rejected",
          policy: PAIRED_SESSION_STOP_POLICIES.identityRejected,
        });
      }
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
  // Injected so tests need no global module mock for the tenant database.
  // Mocking `tenant.service` swaps it for every test file in the run, which
  // breaks suites that need the real Kysely builder.
  tenantDb: Kysely<TenantDatabase> = getTenantConnection(event.companyId),
): Promise<void> {
  const { companyId, connectionId, sessionId, payload } = event;

  // Both event types land here, but only one can recover on its own. A drop is
  // retried with backoff and usually heals unattended; whatsmeow emits
  // LoggedOut after terminal 401/403 session loss, having deleted the
  // credentials, so no retry brings that session back.
  const loggedOut = event.type === "logged_out";

  logger.info(
    { companyId, connectionId, reason: payload.reason, loggedOut },
    loggedOut ? "WhatsApp logged out" : "WhatsApp disconnected",
  );

  try {
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

    if (loggedOut) {
      // Recorded separately from `status`, which stays `disconnected` because
      // that is accurate and is what every status consumer already handles.
      // A QR issued before the logout can no longer pair this device.
      await tenantDb
        .updateTable("whatsapp_connections")
        .set({
          logged_out_at: toDbDate(),
          qr_code: null,
          qr_expires_at: null,
          updated_at: toDbDate(),
        })
        .where("id", "=", connectionId)
        .execute();
    }

    // Broadcast to clients with connectionId
    await broadcastToCompany(
      companyId,
      "disconnected",
      // The code lets clients distinguish the permanent case without changing
      // the event name they already listen for.
      { reason: payload.reason, ...(loggedOut ? { code: "logged_out" } : {}) },
      connectionId,
    );

    // An ordinary disconnect stays quiet because it usually self-heals. This
    // one never does, so it is worth interrupting someone for.
    if (loggedOut) {
      await broadcastToCompany(
        companyId,
        "notification:toast",
        {
          type: "error",
          title: "WhatsApp logged out",
          message:
            "This number was unlinked from WhatsApp. Scan a new QR code to reconnect.",
        },
        connectionId,
      );
    }
  } catch (error) {
    logger.error(
      formatError(error),
      loggedOut
        ? "Failed to handle logged out event"
        : "Failed to handle disconnected event",
    );
    throw error;
  }
}

/**
 * Handles worker connection status events from orchestrator
 * Called when worker crashes, exceeds max restart attempts, or recovers
 */
export async function handleWorkerConnectionStatusEvent(
  event: WorkerConnectionStatusEvent,
  // Injectable for lifecycle-ordering tests. Keeping the default here avoids
  // a process-wide tenant.service mock, which would leak into unrelated suites.
  tenantDb: Kysely<TenantDatabase> = getTenantConnection(event.companyId),
): Promise<void> {
  const { companyId, connectionId, sessionId, payload } = event;

  logger.info(
    { companyId, connectionId, status: payload.status, reason: payload.reason },
    "Worker connection status changed",
  );

  try {
    // Worker lifecycle names are broader than the persisted connection enum.
    // Persist `connecting` as the product's existing `pending` state, but only
    // while the stable account has not already reached `connected`. Orchestrator
    // and worker events use separate queue consumers, so a delayed worker-start
    // announcement can otherwise arrive after the worker's real Connected event
    // and regress a healthy account back to pending indefinitely.
    const dbStatus =
      payload.status === "connected"
        ? "connected"
        : payload.status === "connecting"
          ? "pending"
          : "disconnected";

    if (sessionId && payload.status === "connecting") {
      await tenantDb
        .updateTable("whatsapp_connection_sessions")
        .set({ status: "connecting", updated_at: toDbDate() })
        .where("id", "=", sessionId)
        .where("ended_at", "is", null)
        .where("status", "!=", "connected")
        .execute();
    } else if (sessionId) {
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

    let connectionUpdate = tenantDb
      .updateTable("whatsapp_connections")
      .set({
        status: dbStatus,
        ...(dbStatus === "connected"
          ? { qr_code: null, qr_expires_at: null }
          : {}),
        updated_at: toDbDate(),
      })
      .where("id", "=", connectionId);
    if (payload.status === "connecting") {
      connectionUpdate = connectionUpdate.where("status", "!=", "connected");
    }
    const updated = await connectionUpdate.returning("id").executeTakeFirst();

    // The conditional update is the cross-replica ordering fence. If it did
    // not apply, Connected already won and clients must not receive a stale
    // connecting broadcast that would disable message input anyway.
    if (payload.status === "connecting" && !updated) {
      logger.info(
        { companyId, connectionId },
        "Ignored stale worker connecting status after connection became connected",
      );
      return;
    }

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
