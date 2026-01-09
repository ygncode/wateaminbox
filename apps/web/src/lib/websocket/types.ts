/**
 * WebSocket Types Module
 *
 * Consolidated type definitions for the WebSocket client.
 * This module re-exports shared types and defines client-specific types.
 */

// Re-export all WebSocket types from the shared package
export type {
  WebSocketEventType,
  WebSocketMessage,
  NewMessagePayload,
  MessageStatusPayload,
  MessageDeletedPayload,
  MessageReactionPayload,
  TypingPayload,
  ProfilePicturePayload,
  ConversationUpdatedPayload,
  ConversationReadPayload,
  NotificationPayload,
  ErrorPayload,
  SyncStatusPayload,
  QRCodePayload,
  WhatsAppConnectedPayload,
  WhatsAppDisconnectedPayload,
  AuthSuccessPayload,
  AuthErrorPayload,
  ConnectionStatus,
  EventHandler,
  WebSocketClientConfig,
  PresencePayload,
  MediaDownloadedPayload,
  MediaDownloadFailedPayload,
} from "@whatsapp-web/shared";

// Import for use in local type definitions
import type { ConnectionStatus } from "@whatsapp-web/shared";

/**
 * Connection metrics for monitoring WebSocket health
 */
export interface WebSocketMetrics {
  /** Current latency in milliseconds (based on ping-pong round trip) */
  latency: number | null;
  /** Number of reconnections in current session */
  reconnectCount: number;
  /** Timestamp when connection was established (ms since epoch) */
  connectedAt: number | null;
  /** Connection uptime in milliseconds */
  uptime: number | null;
  /** Last error message and timestamp */
  lastError: { message: string; timestamp: number } | null;
  /** Connection status */
  status: ConnectionStatus;
  /** Number of messages sent in this session */
  messagesSent: number;
  /** Number of messages received in this session */
  messagesReceived: number;
}

/**
 * Message queue item for messages sent while connecting
 * @internal
 */
export interface QueuedMessage {
  type: string;
  payload: unknown;
  resolve: (success: boolean) => void;
}

// Import WebSocketClientConfig for the DefaultConfig type
import type { WebSocketClientConfig as SharedConfig } from "@whatsapp-web/shared";

/**
 * Default configuration values for WebSocket client
 */
export const DEFAULT_CONFIG: Required<
  Omit<SharedConfig, "url" | "token" | "onStatusChange" | "onError">
> = {
  reconnectAttempts: 10,
  reconnectBaseDelay: 1000,
  reconnectMaxDelay: 30000,
  heartbeatInterval: 30000,
  pongTimeout: 10000,
  connectionTimeout: 15000,
};

export type DefaultConfigType = typeof DEFAULT_CONFIG;
