/**
 * WebSocket context types
 *
 * Shared type definitions for WebSocket provider and sub-modules.
 */

import type {
  ConnectionStatus,
  EventHandler,
  WebSocketEventType,
} from "@whatsapp-web/shared";
import type { Message, MessageStatus } from "@whatsapp-web/shared";
import type { WebSocketClient, WebSocketMetrics } from "../../lib/websocket";
import type { TypingIndicator } from "../../stores/chat-store";

// Re-export WebSocketMetrics for consumers
export type { WebSocketMetrics } from "../../lib/websocket";

/**
 * Sync state for a connection
 */
export interface SyncState {
  connectionId: string;
  conversations: number;
  startedAt: Date;
}

/**
 * Sync status API response
 */
export interface SyncStatusResponse {
  syncing: boolean;
  connections: Array<{
    id: string;
    name: string | null;
    phone_number: string | null;
    sync_status: string | null;
    updated_at: string | null;
  }>;
}

/**
 * WebSocket context value exposed to consumers
 */
export interface WebSocketContextValue {
  // Connection state
  status: ConnectionStatus;
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;

  // Sync state
  syncingConnections: Map<string, SyncState>;
  clearSyncingConnections: () => void;

  // Connection methods
  connect: () => void;
  disconnect: () => void;
  reconnect: () => void;

  // Messaging methods
  send: <T>(type: string, payload: T) => boolean;
  subscribe: <T>(
    event: WebSocketEventType,
    handler: EventHandler<T>,
  ) => () => void;

  // Convenience methods
  sendTypingStart: (conversationId: string) => void;
  sendTypingStop: (conversationId: string) => void;
  sendMarkAsRead: (conversationId: string, messageIds: string[]) => void;

  // Metrics
  getMetrics: () => WebSocketMetrics | null;
}

/**
 * Dependencies injected into event handlers
 */
export interface EventHandlerDependencies {
  /** WebSocket client ref */
  wsClientRef: React.MutableRefObject<WebSocketClient | null>;
  /** TanStack Query client ref */
  queryClientRef: React.MutableRefObject<
    ReturnType<typeof import("@tanstack/react-query").useQueryClient>
  >;
  /** Setter for syncing connections state */
  setSyncingConnections: React.Dispatch<
    React.SetStateAction<Map<string, SyncState>>
  >;
  /** Chat store message adding function ref */
  addMessageRef: React.MutableRefObject<
    (conversationId: string, message: Message) => void
  >;
  /** Chat store message status updating function ref */
  updateMessageStatusRef: React.MutableRefObject<
    (conversationId: string, messageId: string, status: MessageStatus) => void
  >;
  /** Chat store typing indicator adding function ref */
  addTypingIndicatorRef: React.MutableRefObject<
    (indicator: TypingIndicator) => void
  >;
  /** Chat store typing indicator removing function ref */
  removeTypingIndicatorRef: React.MutableRefObject<
    (conversationId: string, userId: string) => void
  >;
  /** Typing timeout setter function ref */
  setTypingTimeoutRef: React.MutableRefObject<
    (conversationId: string, userId: string) => void
  >;
  /** Typing timeout clearing function ref */
  clearTypingTimeoutRef: React.MutableRefObject<
    (conversationId: string, userId: string) => void
  >;
}

/**
 * Props for WebSocketProvider component
 */
export interface WebSocketProviderProps {
  children: React.ReactNode;
  autoConnect?: boolean;
}
