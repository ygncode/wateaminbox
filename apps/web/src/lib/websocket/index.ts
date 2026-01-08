/**
 * WebSocket Module
 *
 * Provides a modular WebSocket client with:
 * - Connection management (connect, disconnect, reconnect)
 * - Heartbeat monitoring for connection health
 * - Automatic reconnection with exponential backoff
 * - Message queuing during connection
 * - Event-based message handling
 *
 * Usage:
 * ```ts
 * import { WebSocketClient, getWebSocketClient, resetWebSocketClient } from '@/lib/websocket'
 *
 * // Get or create a singleton client
 * const client = getWebSocketClient({ url: 'ws://localhost:3001/ws' })
 *
 * // Subscribe to events
 * const unsubscribe = client.on('message:new', (payload) => {
 *   console.log('New message:', payload)
 * })
 *
 * // Connect
 * client.connect()
 *
 * // Send messages
 * client.send('typing:start', { conversationId: '123' })
 *
 * // Get metrics
 * const metrics = client.getMetrics()
 *
 * // Disconnect when done
 * client.disconnect()
 * ```
 */

// Main client class and factory functions
// Note: The main WebSocketClient is in websocket.ts (parent directory)
// This index re-exports internal modules for advanced usage

// Types
export type {
  // Shared types (re-exported from @whatsapp-web/shared)
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
  // Client-specific types
  WebSocketMetrics,
  QueuedMessage,
  DefaultConfigType,
} from "./types";

// Configuration
export { DEFAULT_CONFIG } from "./types";

// Internal modules (for advanced usage or testing)
export { HeartbeatManager } from "./heartbeat";
export { ReconnectManager } from "./reconnect";
export { MessageQueue } from "./message-queue";
