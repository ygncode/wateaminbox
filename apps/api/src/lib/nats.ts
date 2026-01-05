import * as nats from "nats";
import {
  connect,
  NatsConnection,
  JetStreamClient,
  JetStreamSubscription,
  JSONCodec,
} from "nats";
import { env } from "./env.js";

// NATS Subjects/Topics - Must match orchestrator subjects
// Updated to support connectionId routing for multi-connection support
export const NATS_SUBJECTS = {
  // Commands to WhatsApp worker (uppercase to match orchestrator)
  // Format: WHATSAPP.commands.{companyId}.{connectionId}
  WHATSAPP_COMMANDS: "WHATSAPP.commands",
  WHATSAPP_SPAWN: "WHATSAPP.commands",
  WHATSAPP_KILL: "WHATSAPP.commands",
  WHATSAPP_SEND: "WHATSAPP.commands",

  // Events from WhatsApp worker
  // Format: WHATSAPP.events.{companyId}.{connectionId}.{eventType}
  WHATSAPP_EVENTS: "WHATSAPP.events",
  WHATSAPP_QR: "WHATSAPP.events",
  WHATSAPP_CONNECTION: "WHATSAPP.events",
  WHATSAPP_MESSAGE: "WHATSAPP.events",
  WHATSAPP_RECEIPT: "WHATSAPP.events",
} as const;

// Message types for NATS communication (snake_case to match Go orchestrator)
export interface NatsCommand {
  type:
    | "spawn"
    | "kill"
    | "send"
    | "post_status"
    | "group_promote_admin"
    | "group_demote_admin"
    | "group_remove_participant"
    | "group_update_settings"
    | "sync_labels"
    | "apply_label"
    | "remove_label"
    | "sync_catalogs"
    | "sync_catalog_products";
  company_id: string;
  connection_id: string;
  timestamp?: string;
}

export interface SpawnCommand extends NatsCommand {
  type: "spawn";
  tenant_schema: string;
  database_url: string;
}

export interface KillCommand extends NatsCommand {
  type: "kill";
  reason?: string;
}

export type MessageType =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "sticker"
  | "location"
  | "contact"
  | "reaction";

export interface SendMessageCommand extends NatsCommand {
  type: "send";
  jid: string;
  content: string;
  message_type: MessageType;
  media_url?: string;
  user_id: string;
}

export type StatusType = "text" | "image" | "video";

export interface PostStatusCommand extends NatsCommand {
  type: "post_status";
  status_type: StatusType;
  content?: string; // Text content or caption
  media_url?: string; // URL of uploaded media
  user_id: string;
}

// Group admin action commands
export interface GroupPromoteAdminCommand extends NatsCommand {
  type: "group_promote_admin";
  group_jid: string;
  participant_jid: string;
  user_id: string;
}

export interface GroupDemoteAdminCommand extends NatsCommand {
  type: "group_demote_admin";
  group_jid: string;
  participant_jid: string;
  user_id: string;
}

export interface GroupRemoveParticipantCommand extends NatsCommand {
  type: "group_remove_participant";
  group_jid: string;
  participant_jid: string;
  user_id: string;
}

export interface GroupUpdateSettingsCommand extends NatsCommand {
  type: "group_update_settings";
  group_jid: string;
  name?: string;
  description?: string;
  user_id: string;
}

// Label sync commands
export interface SyncLabelsCommand extends NatsCommand {
  type: "sync_labels";
  user_id: string;
}

export interface ApplyLabelCommand extends NatsCommand {
  type: "apply_label";
  label_id: string;
  contact_jid: string;
  user_id: string;
}

export interface RemoveLabelCommand extends NatsCommand {
  type: "remove_label";
  label_id: string;
  contact_jid: string;
  user_id: string;
}

// Catalog sync commands
export interface SyncCatalogsCommand extends NatsCommand {
  type: "sync_catalogs";
  user_id: string;
}

export interface SyncCatalogProductsCommand extends NatsCommand {
  type: "sync_catalog_products";
  catalog_id: string;
  user_id: string;
}

export interface WhatsAppEvent {
  type:
    | "qr"
    | "connected"
    | "disconnected"
    | "message"
    | "receipt"
    | "send_confirmation"
    | "status"
    | "contact"
    | "labels"
    | "catalogs"
    | "catalog_products"
    | "profile_picture"
    | "message_revoke"
    | "presence"
    | "typing"
    | "error";
  companyId: string;
  connectionId: string;
  payload: unknown;
  timestamp: string;
}

export interface MessageRevokeEvent extends WhatsAppEvent {
  type: "message_revoke";
  payload: {
    messageId: string;
    from: string;
    to: string;
    timestamp: string;
  };
}

export interface ProfilePictureEvent extends WhatsAppEvent {
  type: "profile_picture";
  payload: {
    jid: string;
    profilePictureUrl: string;
    timestamp: string;
    remove?: boolean;
  };
}

export interface LabelsEvent extends WhatsAppEvent {
  type: "labels";
  payload: {
    labels: Array<{
      labelId: string;
      name: string;
      color: string | null;
      predefinedId: number | null;
    }>;
  };
}

export interface CatalogsEvent extends WhatsAppEvent {
  type: "catalogs";
  payload: {
    catalogs: Array<{
      catalogId: string;
      name: string;
      description?: string;
      currency?: string;
      status?: string;
      businessJid?: string;
      headerImageUrl?: string;
      productCount?: number;
    }>;
  };
}

export interface CatalogProductsEvent extends WhatsAppEvent {
  type: "catalog_products";
  payload: {
    catalogId: string;
    products: Array<{
      productId: string;
      name: string;
      description?: string;
      price?: number;
      currency?: string;
      imageUrls?: string[];
      sku?: string;
      category?: string;
      availability?: string;
      visibility?: string;
      url?: string;
      retailerId?: string;
    }>;
  };
}

export interface QREvent extends WhatsAppEvent {
  type: "qr";
  payload: {
    qrCode: string;
    expiresAt: string;
  };
}

export interface ConnectionEvent extends WhatsAppEvent {
  type: "connected" | "disconnected";
  payload: {
    phoneNumber?: string;
    jid?: string;
    reason?: string;
  };
}

export interface MessageEvent extends WhatsAppEvent {
  type: "message";
  payload: {
    messageId: string;
    from: string;
    to: string;
    fromMe: boolean;
    content: string;
    messageType: string;
    timestamp: string;
    mediaUrl?: string;
    quotedMessageId?: string;
  };
}

export interface ReceiptEvent extends WhatsAppEvent {
  type: "receipt";
  payload: {
    messageId: string;
    status: "sent" | "delivered" | "read";
    timestamp: string;
  };
}

export interface SendConfirmationEvent extends WhatsAppEvent {
  type: "send_confirmation";
  payload: {
    pendingMessageId: string;
    messageId: string;
    timestamp: string;
  };
}

export interface StatusEvent extends WhatsAppEvent {
  type: "status";
  payload: {
    statusId: string;
    fromJid: string;
    mediaType: string | null;
    mediaUrl: string | null;
    caption: string | null;
    timestamp: string;
    expiresAt: string;
  };
}

export interface ContactEvent extends WhatsAppEvent {
  type: "contact";
  payload: {
    jid: string;
    name?: string;
    displayName?: string;
    isGroup: boolean;
    unreadCount?: number;
    profilePictureUrl?: string;
  };
}

export interface PresenceEvent extends WhatsAppEvent {
  type: "presence";
  payload: {
    from: string; // JID of the contact
    unavailable: boolean; // true = offline, false = online
    lastSeen?: string; // ISO 8601 timestamp when contact was last seen (only when going offline)
  };
}

export interface TypingEvent extends WhatsAppEvent {
  type: "typing";
  payload: {
    from: string; // JID of the contact who is typing
    chatJid: string; // JID of the chat where typing occurs
    isTyping: boolean; // true = composing, false = paused
    mediaType?: string; // "text" or "audio"
  };
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
    console.log(`[NATS] Connected to ${env.NATS_URL}`);

    return natsConnection;
  } catch (error) {
    console.error("[NATS] Failed to connect:", error);
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
          console.warn("[NATS] Disconnected from server");
          break;
        case "reconnect":
          console.log("[NATS] Reconnected to server");
          reconnectAttempts = 0;
          break;
        case "reconnecting":
          reconnectAttempts++;
          console.log(`[NATS] Reconnecting... attempt ${reconnectAttempts}`);
          break;
        case "error":
          console.error("[NATS] Connection error:", status.data);
          break;
        case "update":
          console.log("[NATS] Connection updated");
          break;
      }
    }
  })().catch((err) => {
    console.error("[NATS] Status monitoring error:", err);
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
  console.log(
    `[NATS] Published to ${subject}:`,
    command.type,
    command.company_id,
    command.connection_id,
  );
}

/**
 * Builds the command subject with connectionId
 * Format: WHATSAPP.commands.{companyId}.{connectionId}
 */
function buildCommandSubject(companyId: string, connectionId: string): string {
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
  // Ensure sslmode is set for local development
  let dbUrl = databaseUrl;
  if (dbUrl && !dbUrl.includes("sslmode=")) {
    dbUrl += dbUrl.includes("?") ? "&sslmode=disable" : "?sslmode=disable";
  }

  const command: SpawnCommand = {
    type: "spawn",
    company_id: companyId,
    connection_id: connectionId,
    tenant_schema: `tenant_${companyId.replace(/-/g, "_")}`,
    database_url: dbUrl,
  };
  console.log(
    "[NATS] Spawn command DATABASE_URL:",
    dbUrl.replace(/\/\/[^:]+:[^@]+@/, "//***:***@"),
  );
  await publishCommand(NATS_SUBJECTS.WHATSAPP_SPAWN, command);
}

/**
 * Publishes a kill command to disconnect WhatsApp
 */
export async function publishKillCommand(
  companyId: string,
  connectionId: string,
  reason?: string,
): Promise<void> {
  const command: KillCommand = {
    type: "kill",
    company_id: companyId,
    connection_id: connectionId,
    reason,
  };
  await publishCommand(NATS_SUBJECTS.WHATSAPP_KILL, command);
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

      console.log(`[NATS] Downloading media from ${mediaUrl}`);
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

      console.log(
        `[NATS] Downloaded ${mediaData.length} bytes, type: ${mimeType}, filename: ${fileName}`,
      );
    } catch (error) {
      console.error("[NATS] Failed to download media:", error);
      throw new Error("Failed to download media for sending");
    }
  }

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
  };

  // Publish directly to JetStream (not through publishCommand which adds NatsCommand envelope)
  const js = await getJetStreamClient();
  const subject = buildCommandSubject(companyId, connectionId);
  const data = jc.encode(sendCommand);
  await js.publish(subject, data);
  console.log(
    `[NATS] Published send message to ${subject}: to=${jid}, type=${messageType}, media=${mediaData ? `${mediaData.length} bytes` : "none"}, reply_to=${replyTo || "none"}, reply_to_sender=${replyToSender || "none"}`,
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
  const command: PostStatusCommand = {
    type: "post_status",
    company_id: companyId,
    connection_id: connectionId,
    status_type: statusType,
    content,
    media_url: mediaUrl,
    user_id: userId,
  };
  // Publish to company/connection-specific subject so worker can filter
  const subject = buildCommandSubject(companyId, connectionId);
  await publishCommand(subject, command);
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
  const command: GroupPromoteAdminCommand = {
    type: "group_promote_admin",
    company_id: companyId,
    connection_id: connectionId,
    group_jid: groupJid,
    participant_jid: participantJid,
    user_id: userId,
  };
  const subject = buildCommandSubject(companyId, connectionId);
  await publishCommand(subject, command);
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
  const command: GroupDemoteAdminCommand = {
    type: "group_demote_admin",
    company_id: companyId,
    connection_id: connectionId,
    group_jid: groupJid,
    participant_jid: participantJid,
    user_id: userId,
  };
  const subject = buildCommandSubject(companyId, connectionId);
  await publishCommand(subject, command);
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
  const command: GroupRemoveParticipantCommand = {
    type: "group_remove_participant",
    company_id: companyId,
    connection_id: connectionId,
    group_jid: groupJid,
    participant_jid: participantJid,
    user_id: userId,
  };
  const subject = buildCommandSubject(companyId, connectionId);
  await publishCommand(subject, command);
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
  const command: GroupUpdateSettingsCommand = {
    type: "group_update_settings",
    company_id: companyId,
    connection_id: connectionId,
    group_jid: groupJid,
    user_id: userId,
    name,
    description,
  };
  const subject = buildCommandSubject(companyId, connectionId);
  await publishCommand(subject, command);
}

/**
 * Publishes a sync labels command to fetch labels from WhatsApp
 */
export async function publishSyncLabels(
  companyId: string,
  connectionId: string,
  userId: string,
): Promise<void> {
  const command: SyncLabelsCommand = {
    type: "sync_labels",
    company_id: companyId,
    connection_id: connectionId,
    user_id: userId,
  };
  const subject = buildCommandSubject(companyId, connectionId);
  await publishCommand(subject, command);
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
  const command: ApplyLabelCommand = {
    type: "apply_label",
    company_id: companyId,
    connection_id: connectionId,
    label_id: labelId,
    contact_jid: contactJid,
    user_id: userId,
  };
  const subject = buildCommandSubject(companyId, connectionId);
  await publishCommand(subject, command);
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
  const command: RemoveLabelCommand = {
    type: "remove_label",
    company_id: companyId,
    connection_id: connectionId,
    label_id: labelId,
    contact_jid: contactJid,
    user_id: userId,
  };
  const subject = buildCommandSubject(companyId, connectionId);
  await publishCommand(subject, command);
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
  const nc = await getNatsConnection();

  // Create an ephemeral push consumer with a unique deliver subject
  // This allows receiving messages published to JetStream
  const inbox =
    nc.options.inboxPrefix +
    "." +
    Date.now() +
    "." +
    Math.random().toString(36).substring(7);

  const subscription = await js.subscribe(subject, {
    config: {
      deliver_policy: "new",
      ack_policy: "none",
      replay_policy: "instant",
      deliver_subject: inbox,
    },
  } as nats.ConsumerOptsBuilder);

  (async () => {
    for await (const msg of subscription) {
      try {
        const event = jc.decode(msg.data) as WhatsAppEvent;
        await callback(event);
      } catch (error) {
        console.error(
          `[NATS] Error processing message from ${subject}:`,
          error,
        );
      }
    }
  })().catch((err) => {
    console.error(`[NATS] Subscription error for ${subject}:`, err);
  });

  console.log(`[NATS] Subscribed to ${subject} via JetStream`);
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
    console.log("[NATS] Connection closed");
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
  const command: SyncCatalogsCommand = {
    type: "sync_catalogs",
    company_id: companyId,
    connection_id: connectionId,
    user_id: userId,
  };
  const subject = buildCommandSubject(companyId, connectionId);
  await publishCommand(subject, command);
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
  const command: SyncCatalogProductsCommand = {
    type: "sync_catalog_products",
    company_id: companyId,
    connection_id: connectionId,
    catalog_id: catalogId,
    user_id: userId,
  };
  const subject = buildCommandSubject(companyId, connectionId);
  await publishCommand(subject, command);
}
