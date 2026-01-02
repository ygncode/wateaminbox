import {
  connect,
  NatsConnection,
  Subscription,
  JetStreamClient,
  JSONCodec,
} from "nats";
import { env } from "./env.js";

// NATS Subjects/Topics - Must match orchestrator subjects
export const NATS_SUBJECTS = {
  // Commands to WhatsApp worker (uppercase to match orchestrator)
  WHATSAPP_COMMANDS: "WHATSAPP.commands",
  WHATSAPP_SPAWN: "WHATSAPP.commands",
  WHATSAPP_KILL: "WHATSAPP.commands",
  WHATSAPP_SEND: "WHATSAPP.commands",

  // Events from WhatsApp worker
  WHATSAPP_EVENTS: "WHATSAPP.events",
  WHATSAPP_QR: "WHATSAPP.events",
  WHATSAPP_CONNECTION: "WHATSAPP.events",
  WHATSAPP_MESSAGE: "WHATSAPP.events",
  WHATSAPP_RECEIPT: "WHATSAPP.events",
} as const;

// Message types for NATS communication (snake_case to match Go orchestrator)
export interface NatsCommand {
  type: "spawn" | "kill" | "send" | "post_status";
  company_id: string;
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

export interface WhatsAppEvent {
  type:
    | "qr"
    | "connected"
    | "disconnected"
    | "message"
    | "receipt"
    | "status"
    | "contact"
    | "error";
  companyId: string;
  payload: unknown;
  timestamp: string;
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
  );
}

/**
 * Publishes a spawn command to start WhatsApp connection
 */
export async function publishSpawnCommand(
  companyId: string,
  databaseUrl: string,
): Promise<void> {
  const command: SpawnCommand = {
    type: "spawn",
    company_id: companyId,
    tenant_schema: `tenant_${companyId.replace(/-/g, "_")}`,
    database_url: databaseUrl,
  };
  await publishCommand(NATS_SUBJECTS.WHATSAPP_SPAWN, command);
}

/**
 * Publishes a kill command to disconnect WhatsApp
 */
export async function publishKillCommand(
  companyId: string,
  reason?: string,
): Promise<void> {
  const command: KillCommand = {
    type: "kill",
    company_id: companyId,
    reason,
  };
  await publishCommand(NATS_SUBJECTS.WHATSAPP_KILL, command);
}

/**
 * Publishes a send message command to company-specific subject
 */
export async function publishSendMessage(
  companyId: string,
  jid: string,
  content: string,
  messageType: MessageType,
  userId: string,
  mediaUrl?: string,
): Promise<void> {
  const command: SendMessageCommand = {
    type: "send",
    company_id: companyId,
    jid,
    content,
    message_type: messageType,
    media_url: mediaUrl,
    user_id: userId,
  };
  // Publish to company-specific subject so worker can filter
  const subject = `${NATS_SUBJECTS.WHATSAPP_COMMANDS}.${companyId}`;
  await publishCommand(subject, command);
}

/**
 * Publishes a post status command to company-specific subject
 */
export async function publishPostStatus(
  companyId: string,
  statusType: StatusType,
  userId: string,
  content?: string,
  mediaUrl?: string,
): Promise<void> {
  const command: PostStatusCommand = {
    type: "post_status",
    company_id: companyId,
    status_type: statusType,
    content,
    media_url: mediaUrl,
    user_id: userId,
  };
  // Publish to company-specific subject so worker can filter
  const subject = `${NATS_SUBJECTS.WHATSAPP_COMMANDS}.${companyId}`;
  await publishCommand(subject, command);
}

/**
 * Subscribes to a NATS subject
 */
export async function subscribe(
  subject: string,
  callback: (event: WhatsAppEvent) => void | Promise<void>,
): Promise<Subscription> {
  const nc = await getNatsConnection();
  const subscription = nc.subscribe(subject);

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

  console.log(`[NATS] Subscribed to ${subject}`);
  return subscription;
}

/**
 * Subscribes to WhatsApp events for a specific company
 * Uses wildcard to match all event types (qr, status, message, etc.)
 */
export async function subscribeToCompanyEvents(
  companyId: string,
  callback: (event: WhatsAppEvent) => void | Promise<void>,
): Promise<Subscription> {
  // Subscribe to WHATSAPP.events.{companyId}.> to match qr, status, message, etc.
  return subscribe(`${NATS_SUBJECTS.WHATSAPP_EVENTS}.${companyId}.>`, callback);
}

/**
 * Subscribes to all WhatsApp events (for message handler)
 */
export async function subscribeToAllEvents(
  callback: (event: WhatsAppEvent) => void | Promise<void>,
): Promise<Subscription> {
  // Use > wildcard to match all companies and event types
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
