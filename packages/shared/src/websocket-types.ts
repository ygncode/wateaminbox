/**
 * Shared WebSocket types for real-time communication
 *
 * This module provides type definitions shared between the backend (Hono API)
 * and frontend (React client) for WebSocket communication.
 */

import type {
  Message,
  MessageStatus,
  RemoteHistoryStatus,
  ScheduledMessageStatus,
} from "./types/message";

// ============================================================================
// Server-to-Client Event Types
// ============================================================================

/**
 * All possible WebSocket event types sent from server to client
 */
export type ServerToClientEventType =
  // Authentication events
  | "auth_success"
  | "auth_error"
  // WhatsApp connection events
  | "qr"
  | "connected"
  | "disconnected"
  | "connection:status"
  // Message events
  | "message"
  | "message:new"
  | "message:status"
  | "message:deleted"
  | "message:reaction"
  | "message:failed"
  | "scheduled_message:updated"
  // Conversation events
  | "conversation:updated"
  | "conversation:read"
  // Contact events
  | "contact"
  | "contact:updated"
  | "contact:profile_picture"
  | "labels:updated"
  | "catalogs:updated"
  | "command:failed"
  // Presence events
  | "presence:online"
  | "presence:offline"
  // Typing events
  | "typing:start"
  | "typing:stop"
  // Media events
  | "media:downloaded"
  | "media:download_failed"
  // Sync events
  | "sync:start"
  | "sync:progress"
  | "sync:complete"
  | "sync:interrupted"
  | "history:loaded"
  // Notification events
  | "notification:new"
  | "notification:toast"
  // System events
  | "error"
  | "pong"
  | "send_ack"
  | "receipt"
  | "status"
  | "assignment";

/**
 * Alias for frontend compatibility
 */
export type WebSocketEventType = ServerToClientEventType;

// ============================================================================
// Client-to-Server Message Types
// ============================================================================

/**
 * All possible message types sent from client to server
 */
export type ClientToServerMessageType =
  | "auth"
  | "ping"
  | "send_message"
  | "typing:start"
  | "typing:stop";

/**
 * Client message structure
 */
export interface ClientMessage {
  type: ClientToServerMessageType;
  payload?: unknown;
}

/**
 * Authentication payload sent by client
 */
export interface AuthPayload {
  token: string;
  companyId: string;
}

/**
 * Send message payload sent by client
 */
export interface SendMessagePayload {
  jid: string;
  content: string;
  messageType: "text" | "image" | "video" | "audio" | "document" | "sticker";
  mediaUrl?: string;
}

// ============================================================================
// Server Message Structure
// ============================================================================

/**
 * Generic server message structure
 */
export interface ServerMessage<T = unknown> {
  type: ServerToClientEventType;
  payload?: T;
  timestamp: string;
  connectionId?: string;
}

/**
 * Frontend-compatible WebSocket message (uses number timestamp)
 */
export interface WebSocketMessage<T = unknown> {
  type: WebSocketEventType;
  payload: T;
  timestamp: number;
  connectionId?: string;
}

// ============================================================================
// Event Payload Interfaces
// ============================================================================

// --- Authentication Payloads ---

export interface AuthSuccessPayload {
  userId: string;
  companyId: string;
  message: string;
}

export interface AuthErrorPayload {
  message: string;
}

// --- WhatsApp Connection Payloads ---

export interface QRCodePayload {
  qrCode: string;
  expiresAt: string;
  connectionId?: string;
}

export interface WhatsAppConnectedPayload {
  phoneNumber: string;
  jid: string;
  connectionId?: string;
}

export interface WhatsAppDisconnectedPayload {
  reason?: string;
  connectionId?: string;
}

export interface WorkerConnectionStatusPayload {
  status: "error" | "failed" | "connecting" | "connected";
  reason: string;
  connectionId?: string;
}

// --- Message Payloads ---

export interface NewMessagePayload {
  message: Message;
  conversationId: string;
}

export interface MessageStatusPayload {
  messageId: string;
  conversationId: string;
  status: MessageStatus;
}

export interface MessageDeletedPayload {
  messageId: string;
  conversationId: string;
}

export interface MessageReactionPayload {
  messageId: string;
  contactId: string;
  from: string;
  emoji: string;
  reactorPhoneNumber?: string | null;
  reactorName?: string | null;
  reactorAvatarUrl?: string | null;
  isOwn?: boolean;
  timestamp: string;
}

export interface MessageFailedPayload {
  messageId: string;
  conversationId: string;
  reason: string;
  connectionId?: string;
}

export interface ScheduledMessageUpdatedPayload {
  scheduledMessageId: string;
  conversationId: string;
  status: ScheduledMessageStatus;
}

// --- Conversation Payloads ---

export interface ConversationUpdatedPayload {
  conversationId: string;
  lastMessage?: Message;
  unreadCount?: number;
}

export interface ConversationReadPayload {
  contactId: string;
  unreadCount: number;
  readBy: string;
}

// --- Contact Payloads ---

export interface ProfilePicturePayload {
  jid: string;
  profilePictureUrl: string | null;
}

// --- Presence Payloads ---

export interface PresencePayload {
  jid: string;
  isOnline: boolean;
  lastSeen?: string;
}

// --- Typing Payloads ---

export interface TypingPayload {
  conversationId: string;
  userId: string;
  userName: string;
}

// --- Media Payloads ---

export interface MediaDownloadedPayload {
  messageId: string;
  conversationId: string;
  mediaUrl: string;
  mediaSize?: number;
}

export interface MediaDownloadFailedPayload {
  messageId: string;
  conversationId: string;
  error?: string;
}

// --- Sync Payloads ---

export interface SyncStatusPayload {
  messageCount: number;
  conversations: number;
  connectionId?: string;
}

export interface HistoryLoadedPayload {
  conversationId: string;
  messageCount: number;
  status: RemoteHistoryStatus;
  error?: string;
  connectionId?: string;
}

// --- Notification Payloads ---

export interface NotificationPayload {
  notificationId: string;
  userId: string;
  type: "message" | "mention" | "assignment" | "team" | "system";
}

export interface ToastNotificationPayload {
  type: "success" | "error" | "warning" | "info";
  title: string;
  message: string;
  connectionId?: string;
}

// --- Error Payloads ---

export interface ErrorPayload {
  code?: string;
  message: string;
}

// --- Send Acknowledgment Payload ---

export interface SendAckPayload {
  jid: string;
  connectionId: string;
  status: "queued" | "sent" | "failed";
}

// ============================================================================
// Connection Types
// ============================================================================

/**
 * WebSocket connection status
 */
export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

/**
 * Event handler type
 */
export type EventHandler<T = unknown> = (payload: T) => void;

// ============================================================================
// Client Configuration Types
// ============================================================================

/**
 * WebSocket client configuration options
 */
export interface WebSocketClientConfig {
  url: string;
  token?: string;
  reconnectAttempts?: number;
  reconnectBaseDelay?: number;
  reconnectMaxDelay?: number;
  heartbeatInterval?: number;
  pongTimeout?: number;
  connectionTimeout?: number;
  onStatusChange?: (status: ConnectionStatus) => void;
  onError?: (error: Error) => void;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a value is a valid server-to-client event type
 */
export function isServerToClientEventType(
  type: string,
): type is ServerToClientEventType {
  const validTypes: ServerToClientEventType[] = [
    "auth_success",
    "auth_error",
    "qr",
    "connected",
    "disconnected",
    "connection:status",
    "message",
    "message:new",
    "message:status",
    "message:deleted",
    "message:reaction",
    "message:failed",
    "conversation:updated",
    "conversation:read",
    "contact",
    "contact:updated",
    "contact:profile_picture",
    "labels:updated",
    "catalogs:updated",
    "command:failed",
    "presence:online",
    "presence:offline",
    "typing:start",
    "typing:stop",
    "media:downloaded",
    "media:download_failed",
    "sync:start",
    "sync:progress",
    "sync:complete",
    "sync:interrupted",
    "notification:new",
    "notification:toast",
    "error",
    "pong",
    "send_ack",
    "receipt",
    "status",
    "assignment",
  ];
  return validTypes.includes(type as ServerToClientEventType);
}

/**
 * Check if a value is a valid client-to-server message type
 */
export function isClientToServerMessageType(
  type: string,
): type is ClientToServerMessageType {
  return (
    type === "auth" ||
    type === "ping" ||
    type === "send_message" ||
    type === "typing:start" ||
    type === "typing:stop"
  );
}

/**
 * Type guard for NewMessagePayload
 */
export function isNewMessagePayload(
  payload: unknown,
): payload is NewMessagePayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "message" in payload &&
    "conversationId" in payload
  );
}

/**
 * Type guard for MessageStatusPayload
 */
export function isMessageStatusPayload(
  payload: unknown,
): payload is MessageStatusPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "messageId" in payload &&
    "conversationId" in payload &&
    "status" in payload
  );
}

/**
 * Type guard for AuthPayload
 */
export function isAuthPayload(payload: unknown): payload is AuthPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "token" in payload &&
    "companyId" in payload
  );
}

/**
 * Type guard for SendMessagePayload
 */
export function isSendMessagePayload(
  payload: unknown,
): payload is SendMessagePayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "jid" in payload &&
    "content" in payload
  );
}
