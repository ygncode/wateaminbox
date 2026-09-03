import { createLogger, formatError } from "../lib/logger.js";
import { PermanentEventError } from "../lib/nats/client.js";
import {
  type CatalogProductsEvent,
  type CatalogsEvent,
  type CommandResultEvent,
  type ConnectionEvent,
  type ContactEvent,
  type DownloadResponseEvent,
  type GroupEvent,
  type HistorySyncPageEvent,
  type LabelsEvent,
  type MessageEvent,
  type MessageRevokeEvent,
  natsLifecycle,
  type PresenceEvent,
  type ProfilePictureEvent,
  type QREvent,
  type ReactionEvent,
  type ReceiptEvent,
  type SendConfirmationEvent,
  type SendFailedEvent,
  type StatusEvent,
  type SyncStatusEvent,
  type TypingEvent,
  type WhatsAppEvent,
  type WorkerConnectionStatusEvent,
} from "../lib/nats/index.js";
import {
  handleCatalogProductsEvent,
  handleCatalogsEvent,
  handleCommandResultEvent,
  handleConnectedEvent,
  handleContactEvent,
  handleDisconnectedEvent,
  handleDownloadResponseEvent,
  handleErrorEvent,
  handleGroupEvent,
  handleHistorySyncPageEvent,
  handleLabelsEvent,
  handleMessageEvent,
  handleMessageRevokeEvent,
  handlePresenceEvent,
  handleProfilePictureEvent,
  handleQREvent,
  handleReactionEvent,
  handleReceiptEvent,
  handleSendConfirmationEvent,
  handleSendFailedEvent,
  handleStatusEvent,
  handleSyncStatusEvent,
  handleTypingEvent,
  handleWorkerConnectionStatusEvent,
} from "./handlers/index.js";
import { getTenantConnection } from "./tenant.service.js";
import { resolveWhatsAppSession } from "./whatsapp/session.js";

const logger = createLogger("MessageHandler");

export function initializeMessageHandler(): void {
  natsLifecycle.startEventSupervisor(handleWhatsAppEvent);
  logger.info("Event supervisor started");
}

export async function shutdownMessageHandler(): Promise<void> {
  await natsLifecycle.shutdown();
}

export async function handleWhatsAppEvent(event: WhatsAppEvent): Promise<void> {
  const { type, companyId } = event;
  const sessionId = event.connectionId;
  const session = await resolveWhatsAppSession(
    getTenantConnection(companyId),
    sessionId,
  );
  if (!session) {
    throw new PermanentEventError(
      `WhatsApp session ${sessionId} does not exist`,
    );
  }
  if (
    session.status === "ended" &&
    !["connection_status", "disconnected", "logged_out", "error"].includes(type)
  ) {
    logger.info(
      { type, companyId, sessionId },
      "Ignoring late event from ended WhatsApp session",
    );
    return;
  }
  const resolvedEvent = {
    ...event,
    sessionId,
    connectionId: session.connectionId,
  } as WhatsAppEvent;

  logger.debug(
    {
      type,
      companyId,
      connectionId: resolvedEvent.connectionId,
      sessionId,
    },
    "Received WhatsApp event",
  );

  try {
    switch (type) {
      case "qr":
        await handleQREvent(resolvedEvent as QREvent);
        break;

      // PairSuccess carries the same identity payload as Connected. Claiming
      // it is idempotent when the subsequent Connected event arrives.
      case "paired":
      case "connected":
        await handleConnectedEvent(resolvedEvent as ConnectionEvent);
        break;

      // whatsmeow emits LoggedOut for terminal 401/403 session loss. Persist it
      // through the normal disconnect path instead of leaving a false connected
      // account after the worker has deleted its credentials.
      case "logged_out":
      case "disconnected":
        await handleDisconnectedEvent(resolvedEvent as ConnectionEvent);
        break;

      case "message":
        await handleMessageEvent(resolvedEvent as MessageEvent);
        break;

      case "receipt":
        await handleReceiptEvent(resolvedEvent as ReceiptEvent);
        break;

      case "send_confirmation":
        await handleSendConfirmationEvent(
          resolvedEvent as SendConfirmationEvent,
        );
        break;

      case "send_failed":
        await handleSendFailedEvent(resolvedEvent as SendFailedEvent);
        break;

      case "connection_status":
        await handleWorkerConnectionStatusEvent(
          resolvedEvent as WorkerConnectionStatusEvent,
        );
        break;

      case "status":
        await handleStatusEvent(resolvedEvent as StatusEvent);
        break;

      case "contact":
        await handleContactEvent(resolvedEvent as ContactEvent);
        break;

      case "profile_picture":
        await handleProfilePictureEvent(resolvedEvent as ProfilePictureEvent);
        break;

      case "message_revoke":
        await handleMessageRevokeEvent(resolvedEvent as MessageRevokeEvent);
        break;

      case "presence":
        await handlePresenceEvent(resolvedEvent as PresenceEvent);
        break;

      case "typing":
        await handleTypingEvent(resolvedEvent as TypingEvent);
        break;

      case "reaction":
        await handleReactionEvent(resolvedEvent as ReactionEvent);
        break;

      case "download_response":
        await handleDownloadResponseEvent(
          resolvedEvent as DownloadResponseEvent,
        );
        break;

      case "sync_status":
        await handleSyncStatusEvent(resolvedEvent as SyncStatusEvent);
        break;

      case "history_sync_page":
        await handleHistorySyncPageEvent(resolvedEvent as HistorySyncPageEvent);
        break;

      case "labels":
        await handleLabelsEvent(resolvedEvent as LabelsEvent);
        break;

      case "catalogs":
        await handleCatalogsEvent(resolvedEvent as CatalogsEvent);
        break;

      case "catalog_products":
        await handleCatalogProductsEvent(resolvedEvent as CatalogProductsEvent);
        break;

      case "command_result":
        await handleCommandResultEvent(resolvedEvent as CommandResultEvent);
        break;

      case "group":
        await handleGroupEvent(resolvedEvent as GroupEvent);
        break;

      case "error":
        await handleErrorEvent(resolvedEvent);
        break;

      default:
        logger.warn({ type }, "Unknown event type");
    }
  } catch (error) {
    logger.error({ ...formatError(error), type }, "Error processing event");
    throw error;
  }
}

export function isMessageHandlerInitialized(): boolean {
  return natsLifecycle.isConsumerActive();
}
