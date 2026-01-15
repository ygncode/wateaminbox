import type { ServerWebSocket } from "bun";

/**
 * WebSocket data interface - contains connection state and metadata
 */
export interface WSData {
  userId: string;
  companyId: string;
  authenticated: boolean;
  events?: {
    onOpen?: unknown;
    onClose?: unknown;
    onMessage?: unknown;
    onError?: unknown;
  };
  // Heartbeat tracking
  lastPongReceived: number;
  isAlive: boolean;
}

export type WebSocketConnection = ServerWebSocket<WSData>;
