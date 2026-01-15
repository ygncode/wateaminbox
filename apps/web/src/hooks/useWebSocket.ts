import { useCallback, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { getAccessToken } from "../lib/api";
import { useWebSocketStore } from "../stores/websocket-store";
import type { UseWebSocketOptions } from "./websocket/types";
import { useTypingIndicators } from "./websocket/useTypingIndicators";
import { useWebSocketConnection } from "./websocket/useWebSocketConnection";
import { useWebSocketEvents } from "./websocket/useWebSocketEvents";

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const { autoConnect = true } = options;

  // Use sub-hooks
  const connection = useWebSocketConnection();
  const typingIndicators = useTypingIndicators();

  // Set up event handlers
  useWebSocketEvents(options, {
    getClient: connection.getClient,
    handleTypingStart: typingIndicators.handleTypingStart,
    handleTypingStop: typingIndicators.handleTypingStop,
    setError: connection.setError,
  });

  // Auto-connect on mount if enabled and we have a token
  useEffect(() => {
    if (autoConnect && getAccessToken()) {
      connection.connect();
    }

    return () => {
      // Clear all typing timeouts on unmount
      typingIndicators.cleanup();
    };
  }, [autoConnect, connection.connect, typingIndicators.cleanup]);

  // Send typing indicator
  const sendTypingStart = useCallback(
    (conversationId: string) => {
      connection.send("typing:start", { conversationId });
    },
    [connection.send],
  );

  const sendTypingStop = useCallback(
    (conversationId: string) => {
      connection.send("typing:stop", { conversationId });
    },
    [connection.send],
  );

  // Mark messages as read
  const sendMarkAsRead = useCallback(
    (conversationId: string, messageIds: string[]) => {
      connection.send("message:read", { conversationId, messageIds });
    },
    [connection.send],
  );

  return {
    // Connection state
    status: connection.status,
    isConnected: connection.isConnected,
    isConnecting: connection.isConnecting,

    // Connection methods
    connect: connection.connect,
    disconnect: connection.disconnect,

    // Messaging methods
    send: connection.send,
    subscribe: connection.subscribe,
    sendTypingStart,
    sendTypingStop,
    sendMarkAsRead,
  };
}

// Hook for using WebSocket in components that don't need the full API
// Uses useShallow to prevent unnecessary re-renders when object reference changes
export function useWebSocketStatus() {
  return useWebSocketStore(
    useShallow((state) => ({
      status: state.status,
      isConnected: state.status === "connected",
      isConnecting: state.status === "connecting",
      error: state.error,
      lastConnectedAt: state.lastConnectedAt,
      lastDisconnectedAt: state.lastDisconnectedAt,
    })),
  );
}

// Re-export types and sub-hooks for direct usage
export type { UseWebSocketOptions } from "./websocket/types";
export { useTypingIndicators } from "./websocket/useTypingIndicators";
export { useWebSocketConnection } from "./websocket/useWebSocketConnection";
export { useWebSocketEvents } from "./websocket/useWebSocketEvents";
