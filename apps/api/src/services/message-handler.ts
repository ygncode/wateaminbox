import type { JetStreamSubscription } from "nats";
import {
  subscribeToAllEvents,
  type WhatsAppEvent,
  type QREvent,
  type ConnectionEvent,
  type MessageEvent,
  type ReceiptEvent,
  type SendConfirmationEvent,
  type SendFailedEvent,
  type StatusEvent,
  type ContactEvent,
  type ProfilePictureEvent,
  type MessageRevokeEvent,
  type PresenceEvent,
  type TypingEvent,
  type ReactionEvent,
  type DownloadResponseEvent,
  type SyncStatusEvent,
  type WorkerConnectionStatusEvent,
  type LabelsEvent,
  type CatalogsEvent,
  type CatalogProductsEvent,
  type CommandResultEvent,
} from "../lib/nats/index.js";
import { createLogger, formatError } from "../lib/logger.js";

// Import handlers from focused modules
import {
  handleQREvent,
  handleConnectedEvent,
  handleDisconnectedEvent,
  handleWorkerConnectionStatusEvent,
  handleMessageEvent,
  handleReceiptEvent,
  handleSendConfirmationEvent,
  handleSendFailedEvent,
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
  handleLabelsEvent,
  handleCatalogsEvent,
  handleCatalogProductsEvent,
  handleCommandResultEvent,
} from "./handlers/index.js";

const logger = createLogger("MessageHandler");

// Subscription handle
let eventSubscription: JetStreamSubscription | null = null;
let isInitialized = false;
let isShuttingDown = false;

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

  const retryDelayMs = 3000;
  let attempt = 0;
  isShuttingDown = false;

  // Keep trying for the lifetime of the API process. Starting the HTTP server
  // without an event consumer is acceptable briefly, but silently remaining
  // disconnected until the next process restart is not.
  while (!isShuttingDown) {
    attempt++;
    try {
      eventSubscription = await subscribeToAllEvents(handleWhatsAppEvent);
      isInitialized = true;
      logger.info({ attempt }, "Initialized and subscribed to WhatsApp events");
      return;
    } catch (error) {
      logger.warn(
        {
          ...formatError(error),
          attempt,
          retryDelaySeconds: retryDelayMs / 1000,
        },
        "Failed to initialize event consumer; retrying",
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
}

/**
 * Shuts down the message event handler
 */
export async function shutdownMessageHandler(): Promise<void> {
  isShuttingDown = true;
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

      case "send_failed":
        await handleSendFailedEvent(event as SendFailedEvent);
        break;

      case "connection_status":
        await handleWorkerConnectionStatusEvent(
          event as WorkerConnectionStatusEvent,
        );
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

      case "labels":
        await handleLabelsEvent(event as LabelsEvent);
        break;

      case "catalogs":
        await handleCatalogsEvent(event as CatalogsEvent);
        break;

      case "catalog_products":
        await handleCatalogProductsEvent(event as CatalogProductsEvent);
        break;

      case "command_result":
        await handleCommandResultEvent(event as CommandResultEvent);
        break;

      case "error":
        await handleErrorEvent(event);
        break;

      default:
        logger.warn({ type }, "Unknown event type");
    }
  } catch (error) {
    logger.error({ ...formatError(error), type }, "Error processing event");
    throw error;
  }
}

/**
 * Gets initialization status
 */
export function isMessageHandlerInitialized(): boolean {
  return isInitialized;
}
