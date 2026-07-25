/**
 * Error event handlers
 */

import type { WhatsAppEvent } from "../../lib/nats/index.js";
import { broadcastToCompany } from "../../lib/realtime.js";
import { normalizeWorkerErrorToast } from "../toast-notification.service.js";
import { handlerLogger as logger } from "./types.js";

/**
 * Handles error events from WhatsApp worker
 */
export async function handleErrorEvent(event: WhatsAppEvent): Promise<void> {
  const { companyId, connectionId, payload } = event;

  logger.error(
    { companyId, connectionId, workerEvent: event.type },
    "Error event from WhatsApp worker",
  );

  // Broadcast error to clients with connectionId
  await broadcastToCompany(
    companyId,
    "notification:toast",
    normalizeWorkerErrorToast(payload, connectionId),
    connectionId,
  );
}
