import { useCallback, useRef } from "react";
import { getAccessToken } from "../../lib/api";
import {
  type EventHandler,
  getWebSocketClient,
  type WebSocketEventType,
} from "../../lib/websocket";
import { useWebSocketStore } from "../../stores/websocket-store";
import type { WebSocketClient } from "./types";

/**
 * Low-level hook for WebSocket connection management.
 * Handles client initialization, connection, and basic send/subscribe operations.
 */
export function useWebSocketConnection() {
  const wsClientRef = useRef<WebSocketClient | null>(null);

  // Subscribe only to status state value
  const status = useWebSocketStore((state) => state.status);

  // Access actions via getState() to avoid unnecessary subscriptions
  const setStatus = useCallback(
    (newStatus: ReturnType<typeof useWebSocketStore.getState>["status"]) =>
      useWebSocketStore.getState().setStatus(newStatus),
    [],
  );
  const setError = useCallback(
    (error: string | null) => useWebSocketStore.getState().setError(error),
    [],
  );

  // Initialize WebSocket client
  const initializeClient = useCallback(() => {
    if (!wsClientRef.current) {
      const token = getAccessToken();
      wsClientRef.current = getWebSocketClient({
        url: import.meta.env.VITE_WS_URL || "ws://localhost:3000/ws",
        token: token ?? undefined,
        onStatusChange: (newStatus) => {
          setStatus(newStatus);
        },
        onError: (error) => {
          setError(error.message);
        },
      });
    }
    return wsClientRef.current;
  }, [setStatus, setError]);

  // Connect to WebSocket
  const connect = useCallback(() => {
    const client = initializeClient();
    const token = getAccessToken();

    if (token) {
      client.setToken(token);
    }

    client.connect();
  }, [initializeClient]);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    wsClientRef.current?.disconnect();
  }, []);

  // Send a message through WebSocket
  const send = useCallback(function sendMessage<T>(
    type: string,
    payload: T,
  ): boolean {
    return wsClientRef.current?.send(type, payload) ?? false;
  }, []);

  // Subscribe to a specific event
  const subscribe = useCallback(function subscribeToEvent<T>(
    event: WebSocketEventType,
    handler: EventHandler<T>,
  ): () => void {
    return wsClientRef.current?.on(event, handler) ?? (() => {});
  }, []);

  // Get the client instance (for event handlers that need direct access)
  const getClient = useCallback(() => {
    return initializeClient();
  }, [initializeClient]);

  return {
    // Connection state
    status,
    isConnected: status === "connected",
    isConnecting: status === "connecting",

    // Client methods
    getClient,
    initializeClient,
    connect,
    disconnect,
    send,
    subscribe,

    // Store actions (exposed for event handlers)
    setError,
  };
}
