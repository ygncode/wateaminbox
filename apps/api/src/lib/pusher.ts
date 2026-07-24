/**
 * Pusher service for real-time communication
 *
 * Handles broadcasting events to company channels via Pusher.
 * Replaces the custom WebSocket implementation for better scalability.
 */

import Pusher from "pusher";
import { env } from "./env.js";
import { createLogger, formatError } from "./logger.js";

const logger = createLogger("Pusher");
let pusher: Pusher | null = null;

function requirePusher(): Pusher {
  if (pusher) return pusher;

  if (!env.PUSHER_APP_ID || !env.PUSHER_KEY || !env.PUSHER_SECRET) {
    throw new Error(
      "Pusher is not configured. Set PUSHER_APP_ID, PUSHER_KEY, and PUSHER_SECRET.",
    );
  }

  pusher = new Pusher({
    appId: env.PUSHER_APP_ID,
    key: env.PUSHER_KEY,
    secret: env.PUSHER_SECRET,
    cluster: env.PUSHER_CLUSTER,
    useTLS: true,
  });

  return pusher;
}

/**
 * Event types that can be broadcast to clients
 */
export type PusherEventType =
  | "message:new"
  | "message:status"
  | "message:deleted"
  | "message:reaction"
  | "message:failed"
  | "qr"
  | "connected"
  | "disconnected"
  | "connection:status"
  | "typing:start"
  | "typing:stop"
  | "sync:start"
  | "sync:progress"
  | "sync:complete"
  | "sync:interrupted"
  | "media:downloaded"
  | "media:download_failed"
  | "notification:new"
  | "notification:toast"
  | "status"
  | "contact:updated"
  | "contact:profile_picture"
  | "presence:online"
  | "presence:offline"
  | "conversation:read"
  | "conversation:updated";

/**
 * Broadcasts an event to all subscribers of a company's private channel
 *
 * @param companyId - The company ID to broadcast to
 * @param eventType - The type of event being broadcast
 * @param payload - The event payload data
 * @param connectionId - Optional connection ID for filtering/debugging
 */
export async function broadcastToCompany(
  companyId: string,
  eventType: PusherEventType,
  payload: unknown,
  connectionId?: string,
): Promise<void> {
  const channelName = `private-company-${companyId}`;

  try {
    const eventData = {
      payload,
      connectionId,
      timestamp: new Date().toISOString(),
    };

    await requirePusher().trigger(channelName, eventType, eventData);

    // Log specific event types for debugging
    if (eventType === "message:new") {
      logger.debug(
        { companyId, eventType },
        "Broadcast message:new to channel",
      );
    }
    if (
      eventType === "media:downloaded" ||
      eventType === "media:download_failed"
    ) {
      logger.info(
        { companyId, eventType, payload },
        "Broadcast media event to channel",
      );
    }
    if (eventType === "qr") {
      logger.debug(
        { companyId, eventType, connectionId },
        "Broadcast QR code to channel",
      );
    }
  } catch (error) {
    logger.error(
      { error: formatError(error), companyId, eventType },
      "Failed to broadcast event to Pusher",
    );
    // Don't throw - we don't want to break the main flow if Pusher fails
  }
}

/**
 * Broadcasts an event to all subscribers except a specific socket
 * For Pusher, we include the excludeSocketId in the payload so clients can filter
 *
 * @param companyId - The company ID to broadcast to
 * @param eventType - The type of event being broadcast
 * @param payload - The event payload data
 * @param excludeSocketId - Socket ID to exclude (for typing indicators)
 */
export async function broadcastToCompanyExcept(
  companyId: string,
  eventType: PusherEventType,
  payload: unknown,
  excludeSocketId?: string,
): Promise<void> {
  const channelName = `private-company-${companyId}`;

  try {
    const eventData = {
      payload,
      excludeSocketId,
      timestamp: new Date().toISOString(),
    };

    // Use Pusher's socket_id exclusion feature
    const client = requirePusher();
    const params: Pusher.TriggerParams | undefined = excludeSocketId
      ? { socket_id: excludeSocketId }
      : undefined;

    await client.trigger(channelName, eventType, eventData, params);
  } catch (error) {
    logger.error(
      { error: formatError(error), companyId, eventType },
      "Failed to broadcast event to Pusher",
    );
  }
}

/**
 * Authenticates a user for a private channel
 *
 * @param socketId - The Pusher socket ID
 * @param channelName - The channel name being subscribed to
 * @param userId - Optional user ID for presence channels
 * @returns Authentication response for Pusher
 */
export function authenticateChannel(
  socketId: string,
  channelName: string,
  userId?: string,
): Pusher.AuthResponse {
  if (userId) {
    // For presence channels (not currently used, but available)
    return requirePusher().authorizeChannel(socketId, channelName, {
      user_id: userId,
    });
  }

  // For private channels
  return requirePusher().authorizeChannel(socketId, channelName);
}

/**
 * Get the Pusher instance for advanced usage
 */
export function getPusherInstance(): Pusher {
  return requirePusher();
}
