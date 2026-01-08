/**
 * Error event handlers
 */

import type { WhatsAppEvent } from "../../lib/nats/index.js";
import { broadcastToCompany } from "../../routes/ws/index.js";
import { handlerLogger as logger } from "./types.js";

/**
 * Handles error events from WhatsApp worker
 */
export async function handleErrorEvent(event: WhatsAppEvent): Promise<void> {
  const { companyId, connectionId, payload } = event;

  logger.error(
    { companyId, connectionId, payload },
    "Error event from WhatsApp worker",
  );

  // Broadcast error to WebSocket clients with connectionId
  broadcastToCompany(companyId, {
    type: "error",
    connectionId,
    payload,
    timestamp: event.timestamp,
  });
}
