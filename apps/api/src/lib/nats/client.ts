/**
 * NATS Client
 * Connection management and operations for NATS/JetStream
 */

import * as nats from "nats";
import {
  connect,
  NatsConnection,
  JetStreamClient,
  JetStreamSubscription,
  JSONCodec,
} from "nats";
import { nowMs } from "@whatsapp-web/shared";
import { env } from "../env.js";
import { createLogger, formatError } from "../logger.js";
import {
  NATS_SUBJECTS,
  type NatsCommand,
  type WhatsAppEvent,
  type MessageType,
  type StatusType,
} from "./types/index.js";
import { forConnection } from "./command-builder.js";

const logger = createLogger("NATS");

/**
 * Generates a correlation ID for end-to-end message flow tracing
 * Format: timestamp-randomHex (e.g., "1705520000000-a1b2c3d4")
 */
function generateCorrelationId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(16).substring(2, 10);
  return `${timestamp}-${random}`;
}

// Singleton NATS client
let natsConnection: NatsConnection | null = null;
let jetStreamClient: JetStreamClient | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY_MS = 1000;

const jc = JSONCodec<unknown>();

/**
 * Gets or creates the NATS connection
 */
export async function getNatsConnection(): Promise<NatsConnection> {
  if (natsConnection && !natsConnection.isClosed()) {
    return natsConnection;
  }

  try {
    natsConnection = await connect({
      servers: env.NATS_URL,
      name: "whatsapp-api",
      reconnect: true,
      maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS,
      reconnectTimeWait: RECONNECT_DELAY_MS,
      pingInterval: 30000,
      maxPingOut: 3,
    });

    // Set up connection event handlers
    setupConnectionHandlers(natsConnection);

    reconnectAttempts = 0;
    logger.info({ url: env.NATS_URL }, "Connected to NATS");

    return natsConnection;
  } catch (error) {
    logger.error(formatError(error), "Failed to connect to NATS");
    throw error;
  }
}

/**
 * Sets up NATS connection event handlers
 */
function setupConnectionHandlers(nc: NatsConnection): void {
  (async () => {
    for await (const status of nc.status()) {
      switch (status.type) {
        case "disconnect":
          logger.warn("Disconnected from server");
          break;
        case "reconnect":
          logger.info("Reconnected to server");
          reconnectAttempts = 0;
          break;
        case "reconnecting":
          reconnectAttempts++;
          logger.info({ attempt: reconnectAttempts }, "Reconnecting to NATS");
          break;
        case "error":
          logger.error({ error: status.data }, "Connection error");
          break;
        case "update":
          logger.debug("Connection updated");
          break;
      }
    }
  })().catch((err) => {
    logger.error(formatError(err), "Status monitoring error");
  });
}

/**
 * Gets or creates JetStream client
 */
export async function getJetStreamClient(): Promise<JetStreamClient> {
  if (jetStreamClient) {
    return jetStreamClient;
  }

  const nc = await getNatsConnection();
  jetStreamClient = nc.jetstream();
  return jetStreamClient;
}

/**
 * Publishes a command to NATS using JetStream
 * Commands must go through JetStream since the orchestrator uses a JetStream pull subscriber
 */
export async function publishCommand(
  subject: string,
  command: NatsCommand,
): Promise<void> {
  const js = await getJetStreamClient();
  const data = jc.encode(command);
  await js.publish(subject, data);
  logger.debug(
    {
      subject,
      type: command.type,
      companyId: command.company_id,
      connectionId: command.connection_id,
    },
    "Published command to NATS",
  );
}

/**
 * Builds the command subject with connectionId
 * Format: WHATSAPP.commands.{companyId}.{connectionId}
 * Exported for testing purposes
 */
export function buildCommandSubject(
  companyId: string,
  connectionId: string,
): string {
  return `${NATS_SUBJECTS.WHATSAPP_COMMANDS}.${companyId}.${connectionId}`;
}

/**
 * Publishes a spawn command to start WhatsApp connection
 */
export async function publishSpawnCommand(
  companyId: string,
  connectionId: string,
  databaseUrl: string,
): Promise<void> {
  logger.debug(
    { databaseUrl: databaseUrl.replace(/\/\/[^:]+:[^@]+@/, "//***:***@") },
    "Spawn command with redacted DATABASE_URL",
  );
  const publisher = forConnection(
    companyId,
    connectionId,
    publishCommand,
    buildCommandSubject,
  );
  await publisher.spawn(databaseUrl);
}

/**
 * Publishes a kill command to disconnect WhatsApp
 */
export async function publishKillCommand(
  companyId: string,
  connectionId: string,
  reason?: string,
): Promise<void> {
  const publisher = forConnection(
    companyId,
    connectionId,
    publishCommand,
    buildCommandSubject,
  );
  await publisher.kill(reason);
}

/**
 * Publishes a send message command to company/connection-specific subject
 * The command format must match what the Go WhatsApp worker expects:
 * - to: JID of recipient
 * - type: message type (text, image, etc.)
 * - content: message content or caption for media
 * - media_data: byte array of media file (for images, videos, etc.)
 * - reply_to: optional message ID to reply to
 * - reply_to_sender: JID of the sender of the quoted message
 * @param pendingMessageId - The message ID created when saving the pending message to the database.
 *                           This ID is passed through to the Go worker and returned in the confirmation
 *                           event, allowing us to update the correct database record when the message is sent.
 */
export async function publishSendMessage(
  companyId: string,
  connectionId: string,
  jid: string,
  content: string,
  messageType: MessageType,
  userId: string,
  pendingMessageId: string,
  mediaUrl?: string,
  replyTo?: string,
  replyToSender?: string,
): Promise<void> {
  let mediaData: number[] | undefined;
  let caption: string | undefined;
  let fileName: string | undefined;
  let mimeType: string | undefined;

  // For media messages, download the file and prepare media data
  // NOTE: Performance optimization opportunity - we currently re-download from S3 here.
  // Future improvement: Pass media data directly from upload endpoint to avoid this extra fetch.
  // Current flow: Browser → API → S3 → API downloads → NATS → Go
  // Optimized flow: Browser → API → (S3 + NATS simultaneously) → Go
  if (
    mediaUrl &&
    (messageType === "image" ||
      messageType === "video" ||
      messageType === "audio" ||
      messageType === "document")
  ) {
    try {
      // SSRF Protection: Only allow downloads from our S3 endpoint
      const s3Endpoint = new URL(env.S3_ENDPOINT);
      const mediaUrlObj = new URL(mediaUrl);

      // Check if URL is from our S3 endpoint (presigned URLs will have same hostname)
      if (mediaUrlObj.hostname !== s3Endpoint.hostname) {
        throw new Error(
          `SSRF protection: Media URL hostname ${mediaUrlObj.hostname} does not match S3 endpoint ${s3Endpoint.hostname}`,
        );
      }

      logger.debug({ mediaUrl }, "Downloading media from URL");
      const response = await fetch(mediaUrl);

      if (!response.ok) {
        throw new Error(`Failed to download media: ${response.statusText}`);
      }

      // Get MIME type from response headers
      mimeType =
        response.headers.get("content-type") || "application/octet-stream";

      // Extract filename from URL or Content-Disposition header
      const contentDisposition = response.headers.get("content-disposition");
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?(.+)"?/);
        if (match) {
          fileName = match[1];
        }
      }
      if (!fileName) {
        // Extract from URL
        const urlPath = new URL(mediaUrl).pathname;
        fileName = urlPath.split("/").pop() || "file";
      }

      // Convert to byte array
      const arrayBuffer = await response.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      mediaData = Array.from(uint8Array);

      // For media messages, content becomes the caption
      caption = content || undefined;
      content = ""; // Clear content field for media messages

      logger.debug(
        { bytes: mediaData.length, mimeType, fileName },
        "Downloaded media",
      );
    } catch (error) {
      logger.error(formatError(error), "Failed to download media");
      throw new Error("Failed to download media for sending");
    }
  }

  // Generate correlation ID for end-to-end tracing
  const correlationId = generateCorrelationId();

  // Format command to match Go worker's SendMessageCommand struct
  const sendCommand = {
    message_id: pendingMessageId,
    connection_id: connectionId,
    to: jid,
    type: messageType, // Go worker expects "text", "image", etc. directly
    content,
    caption,
    file_name: fileName,
    mime_type: mimeType,
    media_data: mediaData,
    user_id: userId,
    reply_to: replyTo,
    reply_to_sender: replyToSender,
    correlation_id: correlationId,
  };

  // Publish directly to JetStream (not through publishCommand which adds NatsCommand envelope)
  const js = await getJetStreamClient();
  const subject = buildCommandSubject(companyId, connectionId);
  const data = jc.encode(sendCommand);
  await js.publish(subject, data);
  logger.debug(
    {
      subject,
      to: jid,
      type: messageType,
      mediaBytes: mediaData ? mediaData.length : 0,
      replyTo: replyTo || null,
      replyToSender: replyToSender || null,
      correlationId,
      pendingMessageId,
    },
    "Published send message",
  );
}

/**
 * Publishes a post status command to company/connection-specific subject
 */
export async function publishPostStatus(
  companyId: string,
  connectionId: string,
  statusType: StatusType,
  userId: string,
  content?: string,
  mediaUrl?: string,
): Promise<void> {
  const publisher = forConnection(
    companyId,
    connectionId,
    publishCommand,
    buildCommandSubject,
  );
  await publisher.postStatus(statusType, content || "", userId, mediaUrl);
}

/**
 * Publishes a group promote admin command
 */
export async function publishGroupPromoteAdmin(
  companyId: string,
  connectionId: string,
  groupJid: string,
  participantJid: string,
  userId: string,
): Promise<void> {
  const publisher = forConnection(
    companyId,
    connectionId,
    publishCommand,
    buildCommandSubject,
  );
  await publisher.groupPromoteAdmin(groupJid, participantJid, userId);
}

/**
 * Publishes a group demote admin command
 */
export async function publishGroupDemoteAdmin(
  companyId: string,
  connectionId: string,
  groupJid: string,
  participantJid: string,
  userId: string,
): Promise<void> {
  const publisher = forConnection(
    companyId,
    connectionId,
    publishCommand,
    buildCommandSubject,
  );
  await publisher.groupDemoteAdmin(groupJid, participantJid, userId);
}

/**
 * Publishes a group remove participant command
 */
export async function publishGroupRemoveParticipant(
  companyId: string,
  connectionId: string,
  groupJid: string,
  participantJid: string,
  userId: string,
): Promise<void> {
  const publisher = forConnection(
    companyId,
    connectionId,
    publishCommand,
    buildCommandSubject,
  );
  await publisher.groupRemoveParticipant(groupJid, participantJid, userId);
}

/**
 * Publishes a group update settings command
 */
export async function publishGroupUpdateSettings(
  companyId: string,
  connectionId: string,
  groupJid: string,
  userId: string,
  name?: string,
  description?: string,
): Promise<void> {
  const publisher = forConnection(
    companyId,
    connectionId,
    publishCommand,
    buildCommandSubject,
  );
  await publisher.groupUpdateSettings(groupJid, userId, name, description);
}

/**
 * Publishes a sync labels command to fetch labels from WhatsApp
 */
export async function publishSyncLabels(
  companyId: string,
  connectionId: string,
  userId: string,
): Promise<void> {
  const publisher = forConnection(
    companyId,
    connectionId,
    publishCommand,
    buildCommandSubject,
  );
  await publisher.syncLabels(userId);
}

/**
 * Publishes an apply label command to add a label to a contact in WhatsApp
 */
export async function publishApplyLabel(
  companyId: string,
  connectionId: string,
  labelId: string,
  contactJid: string,
  userId: string,
): Promise<void> {
  const publisher = forConnection(
    companyId,
    connectionId,
    publishCommand,
    buildCommandSubject,
  );
  await publisher.applyLabel(labelId, contactJid, userId);
}

/**
 * Publishes a remove label command to remove a label from a contact in WhatsApp
 */
export async function publishRemoveLabel(
  companyId: string,
  connectionId: string,
  labelId: string,
  contactJid: string,
  userId: string,
): Promise<void> {
  const publisher = forConnection(
    companyId,
    connectionId,
    publishCommand,
    buildCommandSubject,
  );
  await publisher.removeLabel(labelId, contactJid, userId);
}

/**
 * Subscribes to a NATS subject using JetStream for event streams
 * This ensures we receive messages published via JetStream
 */
export async function subscribe(
  subject: string,
  callback: (event: WhatsAppEvent) => void | Promise<void>,
): Promise<JetStreamSubscription> {
  const js = await getJetStreamClient();
  // Note: We used to get the nats connection for inbox prefix, but now use static prefix
  await getNatsConnection(); // Ensure connection is established

  // Create an ephemeral push consumer with a unique deliver subject
  // This allows receiving messages published to JetStream
  const inbox =
    "_INBOX." + nowMs() + "." + Math.random().toString(36).substring(7);

  const subscription = await js.subscribe(subject, {
    config: {
      deliver_policy: "new",
      ack_policy: "none",
      replay_policy: "instant",
      deliver_subject: inbox,
    },
  } as unknown as nats.ConsumerOptsBuilder);

  (async () => {
    for await (const msg of subscription) {
      try {
        const event = jc.decode(msg.data) as WhatsAppEvent;
        await callback(event);
      } catch (error) {
        logger.error(
          { ...formatError(error), subject },
          "Error processing message",
        );
      }
    }
  })().catch((err) => {
    logger.error({ ...formatError(err), subject }, "Subscription error");
  });

  logger.info({ subject }, "Subscribed to subject via JetStream");
  return subscription;
}

/**
 * Subscribes to WhatsApp events for a specific company
 * Uses wildcard to match all connections and event types (qr, status, message, etc.)
 */
export async function subscribeToCompanyEvents(
  companyId: string,
  callback: (event: WhatsAppEvent) => void | Promise<void>,
): Promise<JetStreamSubscription> {
  // Subscribe to WHATSAPP.events.{companyId}.> to match all connections and event types
  return subscribe(`${NATS_SUBJECTS.WHATSAPP_EVENTS}.${companyId}.>`, callback);
}

/**
 * Subscribes to WhatsApp events for a specific connection
 */
export async function subscribeToConnectionEvents(
  companyId: string,
  connectionId: string,
  callback: (event: WhatsAppEvent) => void | Promise<void>,
): Promise<JetStreamSubscription> {
  // Subscribe to WHATSAPP.events.{companyId}.{connectionId}.> to match all event types for this connection
  return subscribe(
    `${NATS_SUBJECTS.WHATSAPP_EVENTS}.${companyId}.${connectionId}.>`,
    callback,
  );
}

/**
 * Subscribes to all WhatsApp events (for message handler)
 */
export async function subscribeToAllEvents(
  callback: (event: WhatsAppEvent) => void | Promise<void>,
): Promise<JetStreamSubscription> {
  // Use > wildcard to match all companies, connections and event types
  return subscribe(`${NATS_SUBJECTS.WHATSAPP_EVENTS}.>`, callback);
}

/**
 * Closes the NATS connection
 */
export async function closeNatsConnection(): Promise<void> {
  if (natsConnection) {
    await natsConnection.drain();
    await natsConnection.close();
    natsConnection = null;
    jetStreamClient = null;
    logger.info("Connection closed");
  }
}

/**
 * Checks if NATS is connected
 */
export function isNatsConnected(): boolean {
  return natsConnection !== null && !natsConnection.isClosed();
}

/**
 * Request-response pattern for NATS
 */
export async function request<T>(
  subject: string,
  data: unknown,
  timeout: number = 5000,
): Promise<T> {
  const nc = await getNatsConnection();
  const msg = await nc.request(subject, jc.encode(data), { timeout });
  return jc.decode(msg.data) as T;
}

/**
 * Publishes a sync catalogs command to fetch catalogs from WhatsApp Business
 */
export async function publishSyncCatalogs(
  companyId: string,
  connectionId: string,
  userId: string,
): Promise<void> {
  const publisher = forConnection(
    companyId,
    connectionId,
    publishCommand,
    buildCommandSubject,
  );
  await publisher.syncCatalogs(userId);
}

/**
 * Publishes a sync catalog products command to fetch products for a specific catalog
 */
export async function publishSyncCatalogProducts(
  companyId: string,
  connectionId: string,
  catalogId: string,
  userId: string,
): Promise<void> {
  const publisher = forConnection(
    companyId,
    connectionId,
    publishCommand,
    buildCommandSubject,
  );
  await publisher.syncCatalogProducts(catalogId, userId);
}

/**
 * Publishes a send reaction command
 */
export async function publishSendReaction(
  companyId: string,
  connectionId: string,
  chatJid: string,
  targetMessageId: string,
  emoji: string,
  userId: string,
  fromMe: boolean,
): Promise<void> {
  const sendCommand = {
    message_id: `reaction_${nowMs()}`, // Temporary ID for tracking
    connection_id: connectionId,
    to: chatJid,
    type: "reaction" as MessageType,
    target_message_id: targetMessageId,
    emoji,
    user_id: userId,
    from_me: fromMe, // Add from_me flag
  };

  const js = await getJetStreamClient();
  const subject = buildCommandSubject(companyId, connectionId);
  const data = jc.encode(sendCommand);
  await js.publish(subject, data);
  logger.debug(
    {
      subject,
      chatJid,
      targetMessageId,
      emoji,
      fromMe,
    },
    "Published send reaction",
  );
}

/**
 * Publishes a block contact command to WhatsApp service
 * Fire-and-forget: errors are logged but don't fail the request
 */
export async function publishBlockContact(
  companyId: string,
  connectionId: string,
  contactJid: string,
): Promise<void> {
  try {
    const publisher = forConnection(
      companyId,
      connectionId,
      publishCommand,
      buildCommandSubject,
    );
    await publisher.blockContact(contactJid);
    logger.debug(
      { companyId, connectionId, contactJid },
      "Published block contact command",
    );
  } catch (error) {
    logger.error(formatError(error), "Failed to publish block contact command");
    // Fire-and-forget: don't throw, just log the error
  }
}

/**
 * Publishes an unblock contact command to WhatsApp service
 * Fire-and-forget: errors are logged but don't fail the request
 */
export async function publishUnblockContact(
  companyId: string,
  connectionId: string,
  contactJid: string,
): Promise<void> {
  try {
    const publisher = forConnection(
      companyId,
      connectionId,
      publishCommand,
      buildCommandSubject,
    );
    await publisher.unblockContact(contactJid);
    logger.debug(
      { companyId, connectionId, contactJid },
      "Published unblock contact command",
    );
  } catch (error) {
    logger.error(
      formatError(error),
      "Failed to publish unblock contact command",
    );
    // Fire-and-forget: don't throw, just log the error
  }
}

/**
 * Publishes a typing indicator command to WhatsApp service
 * Fire-and-forget: errors are logged but don't fail the request
 */
export async function publishTypingCommand(
  companyId: string,
  connectionId: string,
  jid: string,
  isTyping: boolean,
): Promise<void> {
  try {
    const typingCommand = {
      type: isTyping ? "typing_start" : "typing_stop",
      jid,
    };

    const js = await getJetStreamClient();
    const subject = buildCommandSubject(companyId, connectionId);
    const data = jc.encode(typingCommand);
    await js.publish(subject, data);
    logger.debug(
      { companyId, connectionId, jid, isTyping },
      "Published typing command",
    );
  } catch (error) {
    logger.error(formatError(error), "Failed to publish typing command");
    // Fire-and-forget: don't throw, just log the error
  }
}
