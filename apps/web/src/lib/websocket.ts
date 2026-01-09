import { nowMs } from "@whatsapp-web/shared";
import { wsLogger } from "./websocket-logger";

// Re-export all types from the types module
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
  WebSocketMetrics,
} from "./websocket/types";

// Import types and constants for use in this file
import type {
  ConnectionStatus,
  EventHandler,
  WebSocketClientConfig,
  WebSocketEventType,
  WebSocketMessage,
  WebSocketMetrics,
} from "./websocket/types";
import { DEFAULT_CONFIG } from "./websocket/types";

// Import extracted modules
import { HeartbeatManager } from "./websocket/heartbeat";
import { ReconnectManager } from "./websocket/reconnect";
import { MessageQueue } from "./websocket/message-queue";

export class WebSocketClient {
  private socket: WebSocket | null = null;
  private config: WebSocketClientConfig & typeof DEFAULT_CONFIG;
  private connectionTimeout: ReturnType<typeof setTimeout> | null = null;
  private eventHandlers: Map<WebSocketEventType, Set<EventHandler>> = new Map();
  private _status: ConnectionStatus = "disconnected";
  private isCleaningUp = false;
  private boundHandlers: {
    onOpen: () => void;
    onClose: (event: CloseEvent) => void;
    onError: (event: Event) => void;
    onMessage: (event: MessageEvent) => void;
  } | null = null;

  // Extracted managers
  private heartbeat: HeartbeatManager;
  private reconnect: ReconnectManager;
  private messageQueue: MessageQueue;

  // Metrics tracking
  private _connectedAt: number | null = null;
  private _messagesSent = 0;
  private _messagesReceived = 0;

  constructor(config: WebSocketClientConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.messageQueue = new MessageQueue();

    // Initialize heartbeat manager
    this.heartbeat = new HeartbeatManager(
      {
        heartbeatInterval: this.config.heartbeatInterval,
        pongTimeout: this.config.pongTimeout,
      },
      {
        sendPing: () => this.sendImmediate("ping", {}),
        onStaleConnection: () => {
          this.cleanupSocket();
          this.setStatus("disconnected");
          this.reconnect.schedule();
        },
        isSocketReady: () => this.isSocketReady(),
      },
    );

    // Initialize reconnect manager
    this.reconnect = new ReconnectManager(
      {
        reconnectAttempts: this.config.reconnectAttempts,
        reconnectBaseDelay: this.config.reconnectBaseDelay,
        reconnectMaxDelay: this.config.reconnectMaxDelay,
      },
      {
        onReconnect: () => this.connect(),
        onMaxAttemptsReached: () => {
          this.setStatus("error");
          this.config.onError?.(new Error("Max reconnection attempts reached"));
        },
      },
    );
  }

  // Getters
  get status(): ConnectionStatus {
    return this._status;
  }

  get isConnected(): boolean {
    return (
      this._status === "connected" &&
      this.socket !== null &&
      this.socket.readyState === WebSocket.OPEN
    );
  }

  get isConnecting(): boolean {
    return (
      this._status === "connecting" &&
      this.socket !== null &&
      this.socket.readyState === WebSocket.CONNECTING
    );
  }

  // Get connection metrics
  getMetrics(): WebSocketMetrics {
    const now = nowMs();
    return {
      latency: this.heartbeat.getLatency(),
      reconnectCount: this.reconnect.getReconnectCount(),
      connectedAt: this._connectedAt,
      uptime:
        this._connectedAt !== null && this._status === "connected"
          ? now - this._connectedAt
          : null,
      lastError: this.reconnect.getLastError(),
      status: this._status,
      messagesSent: this._messagesSent,
      messagesReceived: this._messagesReceived,
    };
  }

  // Check if socket is ready for operations
  private isSocketReady(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  // Set authentication token
  setToken(token: string): void {
    this.config.token = token;
  }

  // Connect to WebSocket server
  connect(): void {
    // Prevent concurrent connection attempts
    if (this.isCleaningUp) {
      wsLogger.warn("Cleanup in progress, deferring connect");
      return;
    }

    // Check if already connected or connecting
    if (this.socket) {
      const state = this.socket.readyState;
      if (state === WebSocket.OPEN) {
        wsLogger.debug("Already connected");
        return;
      }
      if (state === WebSocket.CONNECTING) {
        wsLogger.debug("Connection already in progress");
        return;
      }
      // Socket exists but is closing or closed - clean it up first
      if (state === WebSocket.CLOSING || state === WebSocket.CLOSED) {
        this.cleanupSocket();
      }
    }

    this.reconnect.setManualDisconnect(false);
    this.setStatus("connecting");

    try {
      // Construct URL with auth token as query parameter
      const url = new URL(this.config.url);
      if (this.config.token) {
        url.searchParams.set("token", this.config.token);
      }

      this.socket = new WebSocket(url.toString());
      this.setupEventListeners();
      this.startConnectionTimeout();
    } catch (error) {
      wsLogger.error("Connection error:", error);
      this.setStatus("error");
      this.config.onError?.(
        error instanceof Error ? error : new Error(String(error)),
      );
      this.reconnect.schedule();
    }
  }

  // Disconnect from WebSocket server
  disconnect(): void {
    this.reconnect.setManualDisconnect(true);
    this.cleanup();
    this.setStatus("disconnected");
  }

  // Send a message through WebSocket
  send<T>(type: string, payload: T): boolean {
    // If connected and ready, send immediately
    if (this.isSocketReady()) {
      return this.sendImmediate(type, payload);
    }

    // If connecting, the message will fail - log warning
    if (this.isConnecting) {
      wsLogger.warn("Cannot send message: connection not yet established");
      return false;
    }

    wsLogger.warn("Cannot send message: not connected");
    return false;
  }

  // Send a message and queue if connecting (for critical messages)
  sendQueued<T>(type: string, payload: T): Promise<boolean> {
    // If connected and ready, send immediately
    if (this.isSocketReady()) {
      return Promise.resolve(this.sendImmediate(type, payload));
    }

    // If connecting, queue the message
    if (this.isConnecting) {
      return this.messageQueue.enqueue(type, payload);
    }

    // Not connected and not connecting
    return Promise.resolve(false);
  }

  // Internal immediate send
  private sendImmediate<T>(type: string, payload: T): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      const message = JSON.stringify({
        type,
        payload,
        timestamp: nowMs(),
      });
      this.socket.send(message);
      this._messagesSent++;
      return true;
    } catch (error) {
      wsLogger.error("Send error:", error);
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
    this.eventHandlers.get(event)?.add(handler as EventHandler);

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

  // Wait for connection to be ready
  waitForConnection(timeout: number = 5000): Promise<boolean> {
    if (this.isConnected) {
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        resolve(false);
      }, timeout);

      const checkConnection = () => {
        if (this.isConnected) {
          clearTimeout(timeoutId);
          resolve(true);
        } else if (
          this._status === "error" ||
          this._status === "disconnected"
        ) {
          clearTimeout(timeoutId);
          resolve(false);
        } else {
          setTimeout(checkConnection, 100);
        }
      };

      checkConnection();
    });
  }

  // Private methods
  private setupEventListeners(): void {
    if (!this.socket) return;

    // Remove any existing listeners first
    this.removeSocketListeners();

    // Create bound handlers that we can remove later
    this.boundHandlers = {
      onOpen: this.handleOpen.bind(this),
      onClose: this.handleClose.bind(this),
      onError: this.handleError.bind(this),
      onMessage: this.handleMessageEvent.bind(this),
    };

    this.socket.addEventListener("open", this.boundHandlers.onOpen);
    this.socket.addEventListener("close", this.boundHandlers.onClose);
    this.socket.addEventListener("error", this.boundHandlers.onError);
    this.socket.addEventListener("message", this.boundHandlers.onMessage);
  }

  private removeSocketListeners(): void {
    if (!this.socket || !this.boundHandlers) return;

    this.socket.removeEventListener("open", this.boundHandlers.onOpen);
    this.socket.removeEventListener("close", this.boundHandlers.onClose);
    this.socket.removeEventListener("error", this.boundHandlers.onError);
    this.socket.removeEventListener("message", this.boundHandlers.onMessage);
    this.boundHandlers = null;
  }

  private handleOpen(): void {
    wsLogger.info("Connected - Realtime updates enabled");
    this.clearConnectionTimeout();
    this.setStatus("connected");
    this._connectedAt = nowMs();

    // Process any queued messages
    this.messageQueue.processAll((type, payload) =>
      this.sendImmediate(type, payload),
    );

    // Start heartbeat after connection is stable
    // Small delay to ensure connection is fully established
    setTimeout(() => {
      if (this.isConnected) {
        this.heartbeat.start();
      }
    }, 100);
  }

  private handleClose(event: CloseEvent): void {
    wsLogger.debug("Disconnected:", event.code, event.reason);

    // Stop heartbeat and clear timeouts
    this.heartbeat.stop();
    this.clearConnectionTimeout();
    this.messageQueue.clearAll();

    // Only reconnect if not manually disconnected and not already cleaning up
    if (!this.reconnect.isManuallyDisconnected() && !this.isCleaningUp) {
      this.setStatus("disconnected");
      this.reconnect.schedule();
    }
  }

  private handleError(event: Event): void {
    wsLogger.error("WebSocket error:", event);

    // Track the error in metrics
    this.reconnect.setError("WebSocket connection error");

    // Only set error status if we're not already disconnected/cleaning up
    if (!this.isCleaningUp && this._status !== "disconnected") {
      this.setStatus("error");
      this.config.onError?.(new Error("WebSocket connection error"));
    }
  }

  private handleMessageEvent(event: MessageEvent): void {
    this.handleMessage(event.data);
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data) as WebSocketMessage;

      // Track messages received
      this._messagesReceived++;

      // Debug: log all incoming messages
      wsLogger.debug("Received message:", message.type, message);

      // Handle pong response - calculate latency
      if (message.type === ("pong" as WebSocketEventType)) {
        this.heartbeat.handlePong();
        return;
      }

      // Emit event to handlers
      const handlers = this.eventHandlers.get(message.type);
      if (handlers) {
        wsLogger.debug(
          `Found ${handlers.size} handler(s) for: ${message.type}`,
        );
        handlers.forEach((handler) => {
          try {
            const payloadWithConnection =
              message.connectionId !== undefined &&
              message.payload !== null &&
              typeof message.payload === "object"
                ? {
                    ...(message.payload as Record<string, unknown>),
                    connectionId: message.connectionId,
                  }
                : message.connectionId !== undefined
                  ? { connectionId: message.connectionId }
                  : message.payload;

            handler(payloadWithConnection as unknown as never);
          } catch (error) {
            wsLogger.error(`Handler error for ${message.type}:`, error);
          }
        });
      } else {
        wsLogger.debug(`No handlers registered for: ${message.type}`);
      }
    } catch (error) {
      wsLogger.error("Failed to parse message:", error);
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (this._status !== status) {
      this._status = status;
      this.config.onStatusChange?.(status);
    }
  }

  private startConnectionTimeout(): void {
    this.clearConnectionTimeout();
    this.connectionTimeout = setTimeout(() => {
      if (this._status === "connecting") {
        wsLogger.warn("Connection timeout");
        this.cleanupSocket();
        this.setStatus("error");
        this.config.onError?.(new Error("WebSocket connection timeout"));
        this.reconnect.schedule();
      }
    }, this.config.connectionTimeout);
  }

  private clearConnectionTimeout(): void {
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
  }

  private cleanupSocket(): void {
    if (!this.socket) return;

    // Remove event listeners first to prevent any callbacks during cleanup
    this.removeSocketListeners();

    // Close the socket if it's not already closed
    try {
      if (
        this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING
      ) {
        this.socket.close(1000, "Client cleanup");
      }
    } catch (error) {
      // Ignore errors during close
      wsLogger.debug("Error during socket close:", error);
    }

    this.socket = null;
  }

  private cleanup(): void {
    // Prevent re-entrant cleanup
    if (this.isCleaningUp) return;
    this.isCleaningUp = true;

    try {
      // Clear reconnect timeout
      this.reconnect.cancel();

      // Clear connection timeout
      this.clearConnectionTimeout();

      // Stop heartbeat
      this.heartbeat.stop();

      // Clear message queue
      this.messageQueue.clearAll();

      // Close socket
      this.cleanupSocket();

      // Reset metrics
      this._connectedAt = null;
      this.heartbeat.reset();
    } finally {
      this.isCleaningUp = false;
    }
  }

  // Destroy the client completely
  destroy(): void {
    this.disconnect();
    this.eventHandlers.clear();
    // Reset all metrics
    this.reconnect.reset();
    this._messagesSent = 0;
    this._messagesReceived = 0;
  }

  // Force reconnect (useful for token refresh)
  forceReconnect(): void {
    this.cleanup();
    this.reconnect.setManualDisconnect(false);
    this.connect();
  }

  // Reset reconnect counter (useful after successful operations)
  resetReconnectCounter(): void {
    this.reconnect.resetCounter();
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
