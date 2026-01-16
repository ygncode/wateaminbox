/**
 * WebSocket Provider
 *
 * Provides WebSocket connectivity and real-time event handling for the application.
 * Uses extracted modules for event handling, sync management, and connection lifecycle.
 */

import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useAuth } from "./auth-context";
import { getAccessToken } from "../lib/api";
import {
  type EventHandler,
  resetWebSocketClient,
  type WebSocketClient,
  type WebSocketEventType,
  type WebSocketMetrics,
} from "../lib/websocket";
import { useChatStore } from "../stores/chat-store";
import { useWebSocketStore } from "../stores/websocket-store";

// Import from extracted modules
import {
  type SyncState,
  type WebSocketContextValue,
  type WebSocketProviderProps,
  registerEventHandlers,
  fetchSyncStatus as fetchSyncStatusFn,
  initializeClient as initializeClientFn,
} from "./websocket";

// Typing timeout in milliseconds
const TYPING_TIMEOUT = 5000;

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

export function WebSocketProvider({
  children,
  autoConnect = true,
}: WebSocketProviderProps) {
  const wsClientRef = useRef<WebSocketClient | null>(null);
  const typingTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const isInitializedRef = useRef(false);
  // Track handler unsubscribe functions so we can clean them up before re-registering
  const handlerUnsubscribesRef = useRef<(() => void)[]>([]);
  // Ref to store registerHandlers function for use in forceReconnectWithFreshCredentials
  const registerHandlersRef = useRef<
    ((client: WebSocketClient) => void) | null
  >(null);

  // Track previous company ID to detect changes
  const previousCompanyIdRef = useRef<string | null>(null);

  // Get current company ID from auth context
  const { currentCompanyId } = useAuth();

  // Sync state - track which connections are currently syncing
  const [syncingConnections, setSyncingConnections] = useState<
    Map<string, SyncState>
  >(new Map());

  // TanStack Query client for cache updates
  const queryClient = useQueryClient();
  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;

  // WebSocket store - only subscribe to state values, access actions via getState()
  const status = useWebSocketStore((state) => state.status);
  const error = useWebSocketStore((state) => state.error);

  // Actions accessed via getState() to avoid unnecessary subscriptions
  const setStatus = useCallback(
    (newStatus: ReturnType<typeof useWebSocketStore.getState>["status"]) =>
      useWebSocketStore.getState().setStatus(newStatus),
    [],
  );
  const setError = useCallback(
    (e: string | null) => useWebSocketStore.getState().setError(e),
    [],
  );
  const resetWsStore = useCallback(
    () => useWebSocketStore.getState().reset(),
    [],
  );

  // Chat store actions via getState()
  const addMessage = useCallback(
    (
      ...args: Parameters<
        ReturnType<typeof useChatStore.getState>["addMessage"]
      >
    ) => useChatStore.getState().addMessage(...args),
    [],
  );
  const updateMessageStatus = useCallback(
    (
      ...args: Parameters<
        ReturnType<typeof useChatStore.getState>["updateMessageStatus"]
      >
    ) => useChatStore.getState().updateMessageStatus(...args),
    [],
  );
  const addTypingIndicator = useCallback(
    (
      ...args: Parameters<
        ReturnType<typeof useChatStore.getState>["addTypingIndicator"]
      >
    ) => useChatStore.getState().addTypingIndicator(...args),
    [],
  );
  const removeTypingIndicator = useCallback(
    (
      ...args: Parameters<
        ReturnType<typeof useChatStore.getState>["removeTypingIndicator"]
      >
    ) => useChatStore.getState().removeTypingIndicator(...args),
    [],
  );

  // Initialize WebSocket client
  const initializeClient = useCallback(() => {
    return initializeClientFn(wsClientRef, setStatus, setError);
  }, [setStatus, setError]);

  // Helper to manage typing timeout
  const setTypingTimeout = useCallback(
    (conversationId: string, userId: string) => {
      const key = `${conversationId}:${userId}`;

      // Clear existing timeout
      const existingTimeout = typingTimeoutsRef.current.get(key);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }

      // Set new timeout
      const timeout = setTimeout(() => {
        removeTypingIndicator(conversationId, userId);
        typingTimeoutsRef.current.delete(key);
      }, TYPING_TIMEOUT);

      typingTimeoutsRef.current.set(key, timeout);
    },
    [removeTypingIndicator],
  );

  // Clear typing timeout
  const clearTypingTimeout = useCallback(
    (conversationId: string, userId: string) => {
      const key = `${conversationId}:${userId}`;
      const timeout = typingTimeoutsRef.current.get(key);
      if (timeout) {
        clearTimeout(timeout);
        typingTimeoutsRef.current.delete(key);
      }
    },
    [],
  );

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

  // Reconnect (disconnect then connect)
  const reconnect = useCallback(() => {
    disconnect();
    setTimeout(() => {
      connect();
    }, 100);
  }, [connect, disconnect]);

  // Force reconnect with fresh credentials
  const forceReconnectWithFreshCredentials = useCallback(() => {
    console.log("[WebSocket] 🔄 Force reconnecting with fresh credentials...");
    wsClientRef.current?.disconnect();
    resetWebSocketClient();
    wsClientRef.current = null;

    setTimeout(() => {
      const token = getAccessToken();
      if (token) {
        const client = initializeClient();
        if (registerHandlersRef.current) {
          registerHandlersRef.current(client);
          console.log("[WebSocket] ✅ Handlers re-registered after reconnect");
        }
        client.connect();
      }
    }, 100);
  }, [initializeClient]);

  // Clear syncing connections state
  const clearSyncingConnections = useCallback(() => {
    setSyncingConnections(new Map());
  }, []);

  // Fetch sync status from API
  const fetchSyncStatus = useCallback(async () => {
    await fetchSyncStatusFn(currentCompanyId, setSyncingConnections);
  }, [currentCompanyId]);

  // Fetch initial sync status on mount
  useEffect(() => {
    fetchSyncStatus();
  }, [fetchSyncStatus]);

  // Re-fetch sync status on reconnect
  useEffect(() => {
    if (status === "connected") {
      fetchSyncStatus();
    }
  }, [status, fetchSyncStatus]);

  // Reconnect WebSocket when company ID changes
  useEffect(() => {
    if (previousCompanyIdRef.current === currentCompanyId) {
      return;
    }

    const previousCompanyId = previousCompanyIdRef.current;
    previousCompanyIdRef.current = currentCompanyId;

    if (status !== "connected") {
      return;
    }

    // Company switched to a different one
    if (
      previousCompanyId !== null &&
      currentCompanyId !== null &&
      previousCompanyId !== currentCompanyId
    ) {
      console.log(
        "[WebSocket] Company changed, reconnecting with new company ID:",
        currentCompanyId,
      );
      forceReconnectWithFreshCredentials();
    }

    // First company created (was null, now has value)
    if (previousCompanyId === null && currentCompanyId !== null) {
      console.log(
        "[WebSocket] Company ID set, reconnecting:",
        currentCompanyId,
      );
      forceReconnectWithFreshCredentials();
    }
  }, [currentCompanyId, status, forceReconnectWithFreshCredentials]);

  // Send a message through WebSocket
  const send = useCallback(function sendMessage<T>(
    type: string,
    payload: T,
  ): boolean {
    return wsClientRef.current?.send(type, payload) ?? false;
  }, []);

  // Subscribe to a specific event
  const subscribe = useCallback(
    function subscribeToEvent<T>(
      event: WebSocketEventType,
      handler: EventHandler<T>,
    ): () => void {
      const client = initializeClient();
      return client.on(event, handler);
    },
    [initializeClient],
  );

  // Send typing indicator
  const sendTypingStart = useCallback(
    (conversationId: string) => {
      send("typing:start", { conversationId });
    },
    [send],
  );

  const sendTypingStop = useCallback(
    (conversationId: string) => {
      send("typing:stop", { conversationId });
    },
    [send],
  );

  // Mark messages as read
  const sendMarkAsRead = useCallback(
    (conversationId: string, messageIds: string[]) => {
      send("message:read", { conversationId, messageIds });
    },
    [send],
  );

  // Get connection metrics
  const getMetrics = useCallback((): WebSocketMetrics | null => {
    return wsClientRef.current?.getMetrics() ?? null;
  }, []);

  // Store callbacks in refs to avoid dependency changes triggering reconnects
  const addMessageRef = useRef(addMessage);
  const updateMessageStatusRef = useRef(updateMessageStatus);
  const addTypingIndicatorRef = useRef(addTypingIndicator);
  const removeTypingIndicatorRef = useRef(removeTypingIndicator);
  const setTypingTimeoutRef = useRef(setTypingTimeout);
  const clearTypingTimeoutRef = useRef(clearTypingTimeout);

  // Update refs when callbacks change
  useEffect(() => {
    addMessageRef.current = addMessage;
    updateMessageStatusRef.current = updateMessageStatus;
    addTypingIndicatorRef.current = addTypingIndicator;
    removeTypingIndicatorRef.current = removeTypingIndicator;
    setTypingTimeoutRef.current = setTypingTimeout;
    clearTypingTimeoutRef.current = clearTypingTimeout;
  });

  // Register all WebSocket event handlers on a client
  const registerHandlers = useCallback((client: WebSocketClient) => {
    // Clean up any existing handlers first
    handlerUnsubscribesRef.current.forEach((unsub) => unsub());
    handlerUnsubscribesRef.current = [];

    // Register all handlers using extracted module
    handlerUnsubscribesRef.current = registerEventHandlers(
      client,
      queryClientRef,
      setSyncingConnections,
      {
        addMessageRef,
        updateMessageStatusRef,
        addTypingIndicatorRef,
        removeTypingIndicatorRef,
        setTypingTimeoutRef,
        clearTypingTimeoutRef,
      },
    );
  }, []);

  // Update the ref so forceReconnectWithFreshCredentials can access registerHandlers
  registerHandlersRef.current = registerHandlers;

  // Set up event handlers and auto-connect
  useEffect(() => {
    if (isInitializedRef.current) return;
    isInitializedRef.current = true;

    const client = initializeClient();

    // Register all event handlers
    registerHandlers(client);

    // Auto-connect if enabled and we have a token
    if (autoConnect && getAccessToken()) {
      connect();
    }

    // Cleanup
    return () => {
      // Clean up all registered handlers
      handlerUnsubscribesRef.current.forEach((unsub) => unsub());
      handlerUnsubscribesRef.current = [];

      // Clear all typing timeouts
      typingTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
      typingTimeoutsRef.current.clear();

      // Disconnect and reset
      wsClientRef.current?.disconnect();
      resetWebSocketClient();
      wsClientRef.current = null;
      resetWsStore();
      isInitializedRef.current = false;
    };
  }, [autoConnect, connect, initializeClient, registerHandlers, resetWsStore]);

  // Context value
  const contextValue: WebSocketContextValue = {
    status,
    isConnected: status === "connected",
    isConnecting: status === "connecting",
    error,
    syncingConnections,
    clearSyncingConnections,
    connect,
    disconnect,
    reconnect,
    send,
    subscribe,
    sendTypingStart,
    sendTypingStop,
    sendMarkAsRead,
    getMetrics,
  };

  return (
    <WebSocketContext.Provider value={contextValue}>
      {children}
    </WebSocketContext.Provider>
  );
}

// Hook to use WebSocket context
export function useWebSocketContext(): WebSocketContextValue {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error(
      "useWebSocketContext must be used within a WebSocketProvider",
    );
  }
  return context;
}

// Re-export types
export type { SyncState, WebSocketContextValue, WebSocketMetrics };

/**
 * Hook to access WebSocket connection metrics
 * Returns null if no WebSocket client is available
 */
export function useWebSocketMetrics(): WebSocketMetrics | null {
  const context = useContext(WebSocketContext);
  if (!context) {
    return null;
  }
  return context.getMetrics();
}
