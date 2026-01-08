import type { JetStreamSubscription } from "nats";
import {
  subscribeToAllEvents,
  type WhatsAppEvent,
  type QREvent,
  type ConnectionEvent,
  type MessageEvent,
  type ReceiptEvent,
  type SendConfirmationEvent,
  type StatusEvent,
  type ContactEvent,
  type ProfilePictureEvent,
  type MessageRevokeEvent,
  type PresenceEvent,
  type TypingEvent,
  type ReactionEvent,
  type DownloadResponseEvent,
  type SyncStatusEvent,
} from "../lib/nats/index.js";
import { createLogger, formatError } from "../lib/logger.js";

// Import handlers from focused modules
import {
  handleQREvent,
  handleConnectedEvent,
  handleDisconnectedEvent,
  handleMessageEvent,
  handleReceiptEvent,
  handleSendConfirmationEvent,
  handleStatusEvent,
  handleContactEvent,
  handleProfilePictureEvent,
  handleMessageRevokeEvent,
  handlePresenceEvent,
  handleTypingEvent,
  handleReactionEvent,
  handleDownloadResponseEvent,
  handleSyncStatusEvent,
  handleErrorEvent,
} from "./handlers/index.js";

const logger = createLogger("MessageHandler");

// Subscription handle
let eventSubscription: JetStreamSubscription | null = null;
let isInitialized = false;

/**
 * Initializes the message event handler
 * Subscribes to NATS WhatsApp events and processes them
 * Retries if streams don't exist yet (orchestrator may not have started)
 */
export async function initializeMessageHandler(): Promise<void> {
  if (isInitialized) {
    logger.info("Already initialized");
    return;
  }

  const maxRetries = 10;
  const retryDelayMs = 3000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      eventSubscription = await subscribeToAllEvents(handleWhatsAppEvent);
      isInitialized = true;
      logger.info("Initialized and subscribed to WhatsApp events");
      return;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const isStreamNotFound = errorMessage.includes(
        "no stream matches subject",
      );

      if (isStreamNotFound && attempt < maxRetries) {
        logger.info(
          { attempt, maxRetries, retryDelaySeconds: retryDelayMs / 1000 },
          "Streams not ready, retrying...",
        );
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      } else {
        logger.error(formatError(error), "Failed to initialize");
        throw error;
      }
    }
  }
}

/**
 * Shuts down the message event handler
 */
export async function shutdownMessageHandler(): Promise<void> {
  if (eventSubscription) {
    eventSubscription.unsubscribe();
    eventSubscription = null;
  }
  isInitialized = false;
  logger.info("Shutdown complete");
}

/**
 * Handles incoming WhatsApp events from NATS
 * Routes events to appropriate handlers based on event type
 * Exported for testing purposes
 */
export async function handleWhatsAppEvent(event: WhatsAppEvent): Promise<void> {
  const { type, companyId, connectionId } = event;

  logger.debug(
    { type, companyId, connectionId: connectionId || "unknown" },
    "Received WhatsApp event",
  );

  try {
    switch (type) {
      case "qr":
        await handleQREvent(event as QREvent);
        break;

      case "connected":
        await handleConnectedEvent(event as ConnectionEvent);
        break;

      case "disconnected":
        await handleDisconnectedEvent(event as ConnectionEvent);
        break;

      case "message":
        await handleMessageEvent(event as MessageEvent);
        break;

      case "receipt":
        await handleReceiptEvent(event as ReceiptEvent);
        break;

      case "send_confirmation":
        await handleSendConfirmationEvent(event as SendConfirmationEvent);
        break;

      case "status":
        await handleStatusEvent(event as StatusEvent);
        break;

      case "contact":
        await handleContactEvent(event as ContactEvent);
        break;

      case "profile_picture":
        await handleProfilePictureEvent(event as ProfilePictureEvent);
        break;

      case "message_revoke":
        await handleMessageRevokeEvent(event as MessageRevokeEvent);
        break;

      case "presence":
        await handlePresenceEvent(event as PresenceEvent);
        break;

      case "typing":
        await handleTypingEvent(event as TypingEvent);
        break;

      case "reaction":
        await handleReactionEvent(event as ReactionEvent);
        break;

      case "download_response":
        await handleDownloadResponseEvent(event as DownloadResponseEvent);
        break;

      case "sync_status":
        await handleSyncStatusEvent(event as SyncStatusEvent);
        break;

      case "error":
        await handleErrorEvent(event);
        break;

      default:
        logger.warn({ type }, "Unknown event type");
    }
  } catch (error) {
    logger.error({ ...formatError(error), type }, "Error processing event");
  }
}

/**
 * Gets initialization status
 */
export function isMessageHandlerInitialized(): boolean {
  return isInitialized;
}
