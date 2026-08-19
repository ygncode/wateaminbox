/**
 * NATS Client
 * Connection management and operations for NATS/JetStream
 */

import { nowMs } from "@wateaminbox/shared";
import {
  type ConsumerOptsBuilder,
  consumerOpts,
  type JetStreamClient,
  type JetStreamSubscription,
  JSONCodec,
  type JsMsg,
  type NatsConnection,
} from "nats";
import { z } from "zod";
import { createLogger, formatError } from "../logger.js";
import { getMediaObjectReference } from "../storage.js";
import { forConnection } from "./command-builder.js";
import { natsLifecycle } from "./lifecycle.js";
import {
  type MessageType,
  NATS_SUBJECTS,
  type NatsCommand,
  type StatusType,
  type WhatsAppEvent,
} from "./types/index.js";

const logger = createLogger("NATS");
export const API_EVENTS_DEAD_LETTER_SUBJECT = "WHATSAPP.dead_letter.api_events";

/** Signals that redelivery cannot make an otherwise valid event processable. */
export class PermanentEventError extends Error {
  override readonly name = "PermanentEventError";
}

export const whatsAppEventEnvelopeSchema = z.object({
  // Version 0 (field absent) is accepted during rolling upgrades from workers
  // deployed before envelope versioning. Explicit unknown versions still fail.
  contractVersion: z.literal(1).optional().default(1),
  type: z.enum([
    "qr",
    "connected",
    "disconnected",
    "message",
    "receipt",
    "send_confirmation",
    "send_failed",
    "status",
    "contact",
    "labels",
    "catalogs",
    "catalog_products",
    "profile_picture",
    "message_revoke",
    "presence",
    "typing",
    "reaction",
    "sync_status",
    "history_sync_page",
    "download_response",
    "connection_status",
    "command_result",
    "group",
    "error",
  ]),
  companyId: z.string().uuid(),
  connectionId: z.string().uuid(),
  payload: z.record(z.unknown()),
  timestamp: z.string(),
  correlationId: z.string().optional(),
});

export function parseWhatsAppEvent(value: unknown): WhatsAppEvent {
  return whatsAppEventEnvelopeSchema.parse(value) as WhatsAppEvent;
}

/**
 * Generates a correlation ID for end-to-end message flow tracing
 * Format: timestamp-randomHex (e.g., "1705520000000-a1b2c3d4")
 */
function generateCorrelationId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(16).substring(2, 10);
  return `${timestamp}-${random}`;
}

const jc = JSONCodec<unknown>();

async function publishEventDeadLetter(
  js: JetStreamClient,
  msg: JsMsg,
  error: unknown,
  deliveries: number,
): Promise<void> {
  await js.publish(
    API_EVENTS_DEAD_LETTER_SUBJECT,
    jc.encode({
      sourceSubject: msg.subject,
      deliveries,
      error: error instanceof Error ? error.message : String(error),
      payloadBase64: Buffer.from(msg.data).toString("base64"),
      failedAt: new Date().toISOString(),
    }),
  );
}

export async function getNatsConnection(): Promise<NatsConnection> {
  return natsLifecycle.getConnection();
}

export async function getJetStreamClient(): Promise<JetStreamClient> {
  return natsLifecycle.getJetStreamClient();
}

/**
 * Publishes a command to NATS using JetStream
 * Commands must go through JetStream since the orchestrator uses a JetStream pull subscriber
 */
export async function publishCommand(
  subject: string,
  command: NatsCommand,
): Promise<void> {
  await publishOutboxCommand(subject, command);
}

/**
 * Publishes a serialized outbox command. The outbox row ID is used as the
 * JetStream message ID so a dispatcher crash between publish and commit does
 * not create a second stream message within JetStream's deduplication window.
 */
export async function publishOutboxCommand(
  subject: string,
  command: NatsCommand | Record<string, unknown>,
  outboxId?: string,
): Promise<void> {
  const js = await getJetStreamClient();
  const data = jc.encode(command);
  await js.publish(subject, data, outboxId ? { msgID: outboxId } : undefined);
  logger.debug(
    {
      subject,
      type: command.type,
      companyId: command.company_id,
      connectionId: command.connection_id,
      outboxId,
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
): Promise<void> {
  const publisher = forConnection(
    companyId,
    connectionId,
    publishCommand,
    buildCommandSubject,
  );
  await publisher.spawn();
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
 * - media_object_key: tenant-scoped object-storage key for media
 * - reply_to: optional message ID to reply to
 * - reply_to_sender: JID of the sender of the quoted message
 * @param pendingMessageId - The message ID created when saving the pending message to the database.
 *                           This ID is passed through to the Go worker and returned in the confirmation
 *                           event, allowing us to update the correct database record when the message is sent.
 */
export async function buildSendMessageCommand(
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
): Promise<Record<string, unknown>> {
  let caption: string | undefined;
  let mediaReference:
    | Awaited<ReturnType<typeof getMediaObjectReference>>
    | undefined;

  if (
    mediaUrl &&
    ["image", "video", "audio", "document", "sticker"].includes(messageType)
  ) {
    try {
      // HEAD validates ownership and metadata without moving object bytes
      // through the API process or JetStream.
      mediaReference = await getMediaObjectReference(mediaUrl, companyId);
      caption = content || undefined;
      content = "";
    } catch (error) {
      logger.error(formatError(error), "Invalid media object reference");
      throw new Error("Invalid media object for sending");
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
    file_name: mediaReference?.filename,
    mime_type: mediaReference?.mimeType,
    media_object_key: mediaReference?.key,
    media_size: mediaReference?.size,
    media_checksum: mediaReference?.checksum,
    user_id: userId,
    reply_to: replyTo,
    reply_to_sender: replyToSender,
    correlation_id: correlationId,
  };

  return sendCommand;
}

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
  const command = await buildSendMessageCommand(
    companyId,
    connectionId,
    jid,
    content,
    messageType,
    userId,
    pendingMessageId,
    mediaUrl,
    replyTo,
    replyToSender,
  );
  const subject = buildCommandSubject(companyId, connectionId);
  await publishOutboxCommand(subject, command);
  logger.debug(
    {
      subject,
      to: jid,
      type: messageType,
      mediaObjectKey: command.media_object_key || null,
      mediaSize: command.media_size || 0,
      replyTo: replyTo || null,
      replyToSender: replyToSender || null,
      correlationId: command.correlation_id,
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
export const API_EVENTS_CONSUMER = "whatsapp-api-events-v1";
export const API_EVENTS_DELIVER_SUBJECT = "WHATSAPP.api.events.delivery";
export const API_EVENTS_QUEUE = "whatsapp-api-events";

/**
 * Build the durable consumer used by every API replica.
 *
 * A stable durable name retains events while the API is offline. The queue
 * group ensures that horizontally-scaled API instances process each event
 * once, while explicit acknowledgements only advance after persistence.
 */
export function buildEventConsumerOptions(
  subject: string,
): ConsumerOptsBuilder {
  const opts = consumerOpts();
  opts.durable(API_EVENTS_CONSUMER);
  opts.deliverTo(API_EVENTS_DELIVER_SUBJECT);
  opts.queue(API_EVENTS_QUEUE);
  opts.deliverAll();
  opts.manualAck();
  opts.ackExplicit();
  opts.ackWait(60_000);
  opts.maxDeliver(10);
  opts.maxAckPending(128);
  opts.filterSubject(subject);
  opts.replayInstantly();
  return opts;
}

export async function subscribe(
  subject: string,
  callback: (event: WhatsAppEvent) => void | Promise<void>,
): Promise<JetStreamSubscription> {
  const js = await getJetStreamClient();
  const subscription = await js.subscribe(
    subject,
    buildEventConsumerOptions(subject),
  );

  (async () => {
    for await (const msg of subscription) {
      try {
        let event: WhatsAppEvent;
        try {
          event = parseWhatsAppEvent(jc.decode(msg.data));
        } catch (error) {
          logger.error(
            { ...formatError(error), subject },
            "Terminating invalid NATS event",
          );
          try {
            await publishEventDeadLetter(js, msg, error, 1);
            msg.term();
          } catch (deadLetterError) {
            logger.error(
              { ...formatError(deadLetterError), subject },
              "Failed to persist invalid event to dead-letter stream",
            );
            msg.nak(1_000);
          }
          continue;
        }
        await callback(event);
        msg.ack();
      } catch (error) {
        const deliveries = msg.info?.redeliveryCount ?? 0;
        logger.error(
          { ...formatError(error), subject, deliveries },
          "Error processing message; scheduling redelivery",
        );
        if (error instanceof PermanentEventError || deliveries >= 9) {
          try {
            await publishEventDeadLetter(js, msg, error, deliveries + 1);
            msg.term();
          } catch (deadLetterError) {
            logger.error(
              { ...formatError(deadLetterError), subject },
              "Failed to persist event to dead-letter stream",
            );
            msg.nak(1_000);
          }
        } else {
          msg.nak(1_000);
        }
      }
    }
  })().catch((err) => {
    logger.error({ ...formatError(err), subject }, "Subscription error");
  });

  logger.info(
    { subject, durable: API_EVENTS_CONSUMER },
    "Subscribed to subject via durable JetStream consumer",
  );
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

export async function closeNatsConnection(): Promise<void> {
  await natsLifecycle.shutdown();
}

export function isNatsConnected(): boolean {
  return natsLifecycle.isConnected();
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
export function buildSendReactionCommand(
  connectionId: string,
  chatJid: string,
  targetMessageId: string,
  emoji: string,
  userId: string,
  fromMe: boolean,
  targetSenderJid?: string,
): Record<string, unknown> {
  return {
    message_id: `reaction_${nowMs()}`, // Temporary ID for tracking
    connection_id: connectionId,
    to: chatJid,
    type: "reaction" as MessageType,
    target_message_id: targetMessageId,
    emoji,
    user_id: userId,
    from_me: fromMe,
    target_sender_jid: targetSenderJid,
  };
}

export async function publishSendReaction(
  companyId: string,
  connectionId: string,
  chatJid: string,
  targetMessageId: string,
  emoji: string,
  userId: string,
  fromMe: boolean,
  targetSenderJid?: string,
): Promise<void> {
  const sendCommand = buildSendReactionCommand(
    connectionId,
    chatJid,
    targetMessageId,
    emoji,
    userId,
    fromMe,
    targetSenderJid,
  );
  const subject = buildCommandSubject(companyId, connectionId);
  await publishOutboxCommand(subject, sendCommand);
  logger.debug(
    { subject, chatJid, targetMessageId, emoji, fromMe },
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
