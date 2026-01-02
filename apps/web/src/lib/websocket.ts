import type { Message, MessageStatus } from "@whatsapp-web/shared";

// WebSocket event types
export type WebSocketEventType =
  | "message:new"
  | "message:status"
  | "message:deleted"
  | "typing:start"
  | "typing:stop"
  | "presence:online"
  | "presence:offline"
  | "conversation:updated"
  | "error"
  // WhatsApp connection events
  | "qr"
  | "connected"
  | "disconnected"
  | "auth_success"
  | "auth_error";

// WebSocket message payloads
export interface WebSocketMessage<T = unknown> {
  type: WebSocketEventType;
  payload: T;
  timestamp: number;
}

export interface NewMessagePayload {
  message: Message;
  conversationId: string;
}

export interface MessageStatusPayload {
  messageId: string;
  conversationId: string;
  status: MessageStatus;
}

export interface TypingPayload {
  conversationId: string;
  userId: string;
  userName: string;
}

export interface PresencePayload {
  userId: string;
  status: "online" | "offline";
  lastSeen?: Date;
}

export interface ConversationUpdatedPayload {
  conversationId: string;
  lastMessage?: Message;
  unreadCount?: number;
}

export interface ErrorPayload {
  code: string;
  message: string;
}

// WhatsApp connection event payloads
export interface QRCodePayload {
  qrCode: string;
  expiresAt: string;
}

export interface WhatsAppConnectedPayload {
  phoneNumber: string;
  jid: string;
}

export interface WhatsAppDisconnectedPayload {
  reason?: string;
}

export interface AuthSuccessPayload {
  userId: string;
  companyId: string;
  message: string;
}

export interface AuthErrorPayload {
  message: string;
}

// Connection status
export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

// Event handler type
export type EventHandler<T = unknown> = (payload: T) => void;

// WebSocket client configuration
export interface WebSocketClientConfig {
  url: string;
  token?: string;
  reconnectAttempts?: number;
  reconnectBaseDelay?: number;
  reconnectMaxDelay?: number;
  heartbeatInterval?: number;
  onStatusChange?: (status: ConnectionStatus) => void;
  onError?: (error: Error) => void;
}

const DEFAULT_CONFIG: Required<
  Omit<WebSocketClientConfig, "url" | "token" | "onStatusChange" | "onError">
> = {
  reconnectAttempts: 10,
  reconnectBaseDelay: 1000,
  reconnectMaxDelay: 30000,
  heartbeatInterval: 30000,
};

export class WebSocketClient {
  private socket: WebSocket | null = null;
  private config: WebSocketClientConfig & typeof DEFAULT_CONFIG;
  private reconnectCount = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private pongTimeout: ReturnType<typeof setTimeout> | null = null;
  private eventHandlers: Map<WebSocketEventType, Set<EventHandler>> = new Map();
  private _status: ConnectionStatus = "disconnected";
  private manualDisconnect = false;

  constructor(config: WebSocketClientConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // Getters
  get status(): ConnectionStatus {
    return this._status;
  }

  get isConnected(): boolean {
    return (
      this._status === "connected" && this.socket?.readyState === WebSocket.OPEN
    );
  }

  // Set authentication token
  setToken(token: string): void {
    this.config.token = token;
  }

  // Connect to WebSocket server
  connect(): void {
    if (
      this.socket?.readyState === WebSocket.OPEN ||
      this.socket?.readyState === WebSocket.CONNECTING
    ) {
      console.warn("[WebSocket] Already connected or connecting");
      return;
    }

    this.manualDisconnect = false;
    this.setStatus("connecting");

    try {
      // Construct URL with auth token as query parameter
      const url = new URL(this.config.url);
      if (this.config.token) {
        url.searchParams.set("token", this.config.token);
      }

      this.socket = new WebSocket(url.toString());
      this.setupEventListeners();
    } catch (error) {
      console.error("[WebSocket] Connection error:", error);
      this.setStatus("error");
      this.config.onError?.(
        error instanceof Error ? error : new Error(String(error)),
      );
      this.scheduleReconnect();
    }
  }

  // Disconnect from WebSocket server
  disconnect(): void {
    this.manualDisconnect = true;
    this.cleanup();
    this.setStatus("disconnected");
  }

  // Send a message through WebSocket
  send<T>(type: string, payload: T): boolean {
    if (!this.isConnected) {
      console.warn("[WebSocket] Cannot send message: not connected");
      return false;
    }

    try {
      const message = JSON.stringify({
        type,
        payload,
        timestamp: Date.now(),
      });
      this.socket!.send(message);
      return true;
    } catch (error) {
      console.error("[WebSocket] Send error:", error);
      return false;
    }
  }

  // Subscribe to events
  on<T = unknown>(
    event: WebSocketEventType,
    handler: EventHandler<T>,
  ): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler as EventHandler);

    // Return unsubscribe function
    return () => {
      this.eventHandlers.get(event)?.delete(handler as EventHandler);
    };
  }

  // Unsubscribe from events
  off<T = unknown>(event: WebSocketEventType, handler: EventHandler<T>): void {
    this.eventHandlers.get(event)?.delete(handler as EventHandler);
  }

  // Subscribe to all events of a type once
  once<T = unknown>(event: WebSocketEventType, handler: EventHandler<T>): void {
    const wrappedHandler: EventHandler<T> = (payload) => {
      this.off(event, wrappedHandler);
      handler(payload);
    };
    this.on(event, wrappedHandler);
  }

  // Private methods
  private setupEventListeners(): void {
    if (!this.socket) return;

    this.socket.onopen = () => {
      console.log("[WebSocket] Connected");
      this.setStatus("connected");
      this.reconnectCount = 0;
      this.startHeartbeat();
    };

    this.socket.onclose = (event) => {
      console.log("[WebSocket] Disconnected:", event.code, event.reason);
      this.stopHeartbeat();

      if (!this.manualDisconnect) {
        this.setStatus("disconnected");
        this.scheduleReconnect();
      }
    };

    this.socket.onerror = (event) => {
      console.error("[WebSocket] Error:", event);
      this.setStatus("error");
      this.config.onError?.(new Error("WebSocket connection error"));
    };

    this.socket.onmessage = (event) => {
      this.handleMessage(event.data);
    };
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data) as WebSocketMessage;

      // Handle pong response
      if (message.type === ("pong" as WebSocketEventType)) {
        this.clearPongTimeout();
        return;
      }

      // Emit event to handlers
      const handlers = this.eventHandlers.get(message.type);
      if (handlers) {
        handlers.forEach((handler) => {
          try {
            handler(message.payload);
          } catch (error) {
            console.error(
              `[WebSocket] Handler error for ${message.type}:`,
              error,
            );
          }
        });
      }
    } catch (error) {
      console.error("[WebSocket] Failed to parse message:", error);
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (this._status !== status) {
      this._status = status;
      this.config.onStatusChange?.(status);
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatInterval = setInterval(() => {
      if (this.isConnected) {
        this.send("ping", {});
        this.setPongTimeout();
      }
    }, this.config.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    this.clearPongTimeout();
  }

  private setPongTimeout(): void {
    this.clearPongTimeout();
    this.pongTimeout = setTimeout(() => {
      console.warn("[WebSocket] Pong timeout - reconnecting");
      this.socket?.close();
    }, 10000); // 10 seconds timeout for pong
  }

  private clearPongTimeout(): void {
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.manualDisconnect) return;

    if (this.reconnectCount >= this.config.reconnectAttempts) {
      console.error("[WebSocket] Max reconnection attempts reached");
      this.setStatus("error");
      this.config.onError?.(new Error("Max reconnection attempts reached"));
      return;
    }

    // Exponential backoff with jitter
    const delay = Math.min(
      this.config.reconnectBaseDelay * Math.pow(2, this.reconnectCount) +
        Math.random() * 1000,
      this.config.reconnectMaxDelay,
    );

    console.log(
      `[WebSocket] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectCount + 1})`,
    );

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectCount++;
      this.connect();
    }, delay);
  }

  private cleanup(): void {
    // Clear reconnect timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    // Stop heartbeat
    this.stopHeartbeat();

    // Close socket
    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onclose = null;
      this.socket.onerror = null;
      this.socket.onmessage = null;

      if (
        this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING
      ) {
        this.socket.close();
      }
      this.socket = null;
    }

    // Reset reconnect counter
    this.reconnectCount = 0;
  }

  // Destroy the client completely
  destroy(): void {
    this.disconnect();
    this.eventHandlers.clear();
  }
}

// Create a singleton instance with default configuration
let wsClientInstance: WebSocketClient | null = null;

export function getWebSocketClient(
  config?: Partial<WebSocketClientConfig>,
): WebSocketClient {
  if (!wsClientInstance) {
    wsClientInstance = new WebSocketClient({
      url: config?.url ?? "ws://localhost:3000/ws",
      ...config,
    });
  }
  return wsClientInstance;
}

export function resetWebSocketClient(): void {
  wsClientInstance?.destroy();
  wsClientInstance = null;
}
