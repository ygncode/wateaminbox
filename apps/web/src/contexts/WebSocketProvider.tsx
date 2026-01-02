import {
  createContext,
  useContext,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import {
  WebSocketClient,
  getWebSocketClient,
  resetWebSocketClient,
  type ConnectionStatus,
  type WebSocketEventType,
  type EventHandler,
  type NewMessagePayload,
  type MessageStatusPayload,
  type TypingPayload,
  type ConversationUpdatedPayload,
} from "../lib/websocket";
import { getAccessToken, getCompanyId } from "../lib/api";
import { useWebSocketStore } from "../stores/websocket-store";
import { useChatStore, type TypingIndicator } from "../stores/chat-store";

// Context value type
interface WebSocketContextValue {
  // Connection state
  status: ConnectionStatus;
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;

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
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

// Typing timeout in milliseconds
const TYPING_TIMEOUT = 5000;

interface WebSocketProviderProps {
  children: ReactNode;
  autoConnect?: boolean;
}

export function WebSocketProvider({
  children,
  autoConnect = true,
}: WebSocketProviderProps) {
  const wsClientRef = useRef<WebSocketClient | null>(null);
  const typingTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const isInitializedRef = useRef(false);

  // WebSocket store
  const status = useWebSocketStore((state) => state.status);
  const error = useWebSocketStore((state) => state.error);
  const setStatus = useWebSocketStore((state) => state.setStatus);
  const setError = useWebSocketStore((state) => state.setError);
  const resetWsStore = useWebSocketStore((state) => state.reset);

  // Chat store
  const addMessage = useChatStore((state) => state.addMessage);
  const updateMessageStatus = useChatStore(
    (state) => state.updateMessageStatus,
  );
  const addTypingIndicator = useChatStore((state) => state.addTypingIndicator);
  const removeTypingIndicator = useChatStore(
    (state) => state.removeTypingIndicator,
  );

  // Initialize WebSocket client
  const initializeClient = useCallback(() => {
    if (!wsClientRef.current) {
      const token = getAccessToken();
      const companyId = getCompanyId();

      // Build WebSocket URL with token and company ID
      const baseUrl = import.meta.env.VITE_WS_URL || "ws://localhost:3000/ws";
      const wsUrl = new URL(baseUrl);
      if (token) {
        wsUrl.searchParams.set("token", token);
      }
      if (companyId) {
        wsUrl.searchParams.set("company", companyId);
      }

      wsClientRef.current = getWebSocketClient({
        url: wsUrl.toString(),
        token: token ?? undefined,
        onStatusChange: (newStatus) => {
          setStatus(newStatus);
        },
        onError: (err) => {
          setError(err.message);
        },
      });
    }
    return wsClientRef.current;
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
    // Small delay before reconnecting
    setTimeout(() => {
      connect();
    }, 100);
  }, [connect, disconnect]);

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

  // Set up event handlers and auto-connect
  useEffect(() => {
    if (isInitializedRef.current) return;
    isInitializedRef.current = true;

    const client = initializeClient();

    // New message handler
    const unsubNewMessage = client.on<NewMessagePayload>(
      "message:new",
      (payload) => {
        addMessage(payload.conversationId, payload.message);
      },
    );

    // Message status handler
    const unsubMessageStatus = client.on<MessageStatusPayload>(
      "message:status",
      (payload) => {
        updateMessageStatus(
          payload.conversationId,
          payload.messageId,
          payload.status,
        );
      },
    );

    // Typing start handler
    const unsubTypingStart = client.on<TypingPayload>(
      "typing:start",
      (payload) => {
        const indicator: TypingIndicator = {
          conversationId: payload.conversationId,
          userId: payload.userId,
          userName: payload.userName,
          startedAt: new Date(),
        };
        addTypingIndicator(indicator);
        setTypingTimeout(payload.conversationId, payload.userId);
      },
    );

    // Typing stop handler
    const unsubTypingStop = client.on<TypingPayload>(
      "typing:stop",
      (payload) => {
        removeTypingIndicator(payload.conversationId, payload.userId);
        clearTypingTimeout(payload.conversationId, payload.userId);
      },
    );

    // Conversation updated handler (can be used by consumers)
    const unsubConversationUpdated = client.on<ConversationUpdatedPayload>(
      "conversation:updated",
      () => {
        // This event can be handled by individual components via subscribe
      },
    );

    // Auto-connect if enabled and we have a token
    if (autoConnect && getAccessToken()) {
      connect();
    }

    // Cleanup
    return () => {
      unsubNewMessage();
      unsubMessageStatus();
      unsubTypingStart();
      unsubTypingStop();
      unsubConversationUpdated();

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
  }, [
    autoConnect,
    connect,
    initializeClient,
    addMessage,
    updateMessageStatus,
    addTypingIndicator,
    removeTypingIndicator,
    setTypingTimeout,
    clearTypingTimeout,
    resetWsStore,
  ]);

  // Context value
  const contextValue: WebSocketContextValue = {
    status,
    isConnected: status === "connected",
    isConnecting: status === "connecting",
    error,
    connect,
    disconnect,
    reconnect,
    send,
    subscribe,
    sendTypingStart,
    sendTypingStop,
    sendMarkAsRead,
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
export type { WebSocketContextValue };
