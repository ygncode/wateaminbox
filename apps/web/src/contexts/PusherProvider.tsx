/**
 * Pusher Provider
 *
 * Provides real-time communication via Pusher.
 * Central realtime provider for scalable company-scoped events.
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
import { api } from "../lib/api";
import { broadcastMessagesRead, sendTypingIndicator } from "../lib/api/actions";
import {
  bindEvent,
  disconnectPusher,
  getConnectionState,
  initializePusher,
  onConnectionStateChange,
  type PusherConnectionStatus,
  type PusherEventData,
  type PusherEventType,
  subscribeToCompany,
  unsubscribeFromCompany,
} from "../lib/pusher";
import { useChatStore } from "../stores/chat-store";
import { useAuth } from "./auth-context";
import {
  reconcileRealtimeState,
  registerRealtimeEventHandlers,
  type SyncState,
} from "./realtime/event-handlers";

// Typing timeout in milliseconds
const TYPING_TIMEOUT = 5000;

export type { SyncState } from "./realtime/event-handlers";

/**
 * Event handler type for subscribe function (backward compatibility)
 */
type EventHandler<T = unknown> = (payload: T) => void;

/**
 * Context value for Pusher provider
 */
export interface PusherContextValue {
  // Connection state
  status: PusherConnectionStatus;
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

  // Event subscription
  subscribe: <T>(eventType: string, handler: EventHandler<T>) => () => void;

  // Messaging methods
  sendTypingStart: (conversationId: string, contactId: string) => void;
  sendTypingStop: (conversationId: string, contactId: string) => void;
  sendMarkAsRead: (conversationId: string, messageIds: string[]) => void;
}

interface PusherProviderProps {
  children: React.ReactNode;
  autoConnect?: boolean;
}

const PusherContext = createContext<PusherContextValue | null>(null);

export function PusherProvider({
  children,
  autoConnect = true,
}: PusherProviderProps) {
  const [status, setStatus] = useState<PusherConnectionStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [syncingConnections, setSyncingConnections] = useState<
    Map<string, SyncState>
  >(new Map());

  const typingTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const isInitializedRef = useRef(false);
  const eventUnsubscribesRef = useRef<(() => void)[]>([]);

  // Get current company ID from auth context
  const { currentCompanyId } = useAuth();

  // TanStack Query client for cache updates
  const queryClient = useQueryClient();
  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;

  // Chat store callbacks are limited to ephemeral typing state.
  const addTypingIndicatorRef = useRef(
    useChatStore.getState().addTypingIndicator,
  );
  const removeTypingIndicatorRef = useRef(
    useChatStore.getState().removeTypingIndicator,
  );

  // Update refs when store changes
  useEffect(() => {
    const unsub = useChatStore.subscribe((state) => {
      addTypingIndicatorRef.current = state.addTypingIndicator;
      removeTypingIndicatorRef.current = state.removeTypingIndicator;
    });
    return unsub;
  }, []);

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
        removeTypingIndicatorRef.current(conversationId, userId);
        typingTimeoutsRef.current.delete(key);
      }, TYPING_TIMEOUT);

      typingTimeoutsRef.current.set(key, timeout);
    },
    [],
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

  // Register all company-scoped Pusher event handlers.
  const registerEventHandlers = useCallback(() => {
    eventUnsubscribesRef.current.forEach((unsubscribe) => unsubscribe());
    eventUnsubscribesRef.current = registerRealtimeEventHandlers({
      queryClient: queryClientRef.current,
      companyId: currentCompanyId!,
      setSyncingConnections,
      addTypingIndicator: (indicator) =>
        addTypingIndicatorRef.current(indicator),
      removeTypingIndicator: (conversationId, userId) =>
        removeTypingIndicatorRef.current(conversationId, userId),
      setTypingTimeout,
      clearTypingTimeout,
    });
  }, [setTypingTimeout, clearTypingTimeout, currentCompanyId]);

  // Connect to Pusher
  const connect = useCallback(() => {
    if (!currentCompanyId) {
      return;
    }

    try {
      initializePusher();
      subscribeToCompany(currentCompanyId);
      registerEventHandlers();
    } catch (connectionError) {
      setStatus("failed");
      setError(
        connectionError instanceof Error
          ? connectionError.message
          : "Realtime connection failed",
      );
      return;
    }

    // Set up connection state listener
    const unsub = onConnectionStateChange((state) => {
      setStatus(state);
      if (state === "connected") {
        setError(null);
      } else if (state === "failed" || state === "unavailable") {
        setError("Connection failed");
      }
    });

    eventUnsubscribesRef.current.push(unsub);

    // Set initial state
    setStatus(getConnectionState());
  }, [currentCompanyId, registerEventHandlers]);

  // Disconnect from Pusher
  const disconnect = useCallback(() => {
    eventUnsubscribesRef.current.forEach((unsub) => unsub());
    eventUnsubscribesRef.current = [];
    unsubscribeFromCompany();
    setStatus("disconnected");
  }, []);

  // Reconnect to Pusher
  const reconnect = useCallback(() => {
    disconnect();
    setTimeout(() => {
      connect();
    }, 100);
  }, [connect, disconnect]);

  // Clear syncing connections
  const clearSyncingConnections = useCallback(() => {
    setSyncingConnections(new Map());
  }, []);

  // Fetch initial sync status
  const fetchSyncStatus = useCallback(async () => {
    if (!currentCompanyId) return;

    try {
      const response = await api.get<{
        connections: Array<{
          id: string;
          sync_status: string | null;
          updated_at: string | null;
        }>;
      }>("/whatsapp/sync-status");

      const newMap = new Map<string, SyncState>();
      for (const conn of response.connections) {
        if (conn.sync_status === "syncing") {
          newMap.set(conn.id, {
            connectionId: conn.id,
            conversations: 0,
            startedAt: conn.updated_at ? new Date(conn.updated_at) : new Date(),
          });
        }
      }
      setSyncingConnections(newMap);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch sync status",
      );
    }
  }, [currentCompanyId]);

  // Send typing indicator via REST
  const sendTypingStart = useCallback(
    (conversationId: string, contactId: string) => {
      sendTypingIndicator(conversationId, contactId, true).catch(() => {});
    },
    [],
  );

  const sendTypingStop = useCallback(
    (conversationId: string, contactId: string) => {
      sendTypingIndicator(conversationId, contactId, false).catch(() => {});
    },
    [],
  );

  // Mark messages as read
  const sendMarkAsRead = useCallback(
    (conversationId: string, messageIds: string[]) => {
      broadcastMessagesRead(conversationId, messageIds).catch(() => {});
    },
    [],
  );

  // Allow feature hooks to listen for specific company events.
  const subscribe = useCallback(
    <T,>(eventType: string, handler: EventHandler<T>): (() => void) => {
      // Wrap the handler to extract payload from PusherEventData
      const wrappedHandler = (data: PusherEventData<T>) => {
        // Include the connection ID in payloads consumed by connection hooks.
        const payload = {
          ...data.payload,
          connectionId: data.connectionId,
        } as T;
        handler(payload);
      };

      return bindEvent(eventType as PusherEventType, wrappedHandler);
    },
    [],
  );

  // Initialize on mount
  useEffect(() => {
    if (isInitializedRef.current) return;
    isInitializedRef.current = true;

    if (autoConnect && currentCompanyId) {
      connect();
      fetchSyncStatus();
    }

    return () => {
      eventUnsubscribesRef.current.forEach((unsub) => unsub());
      eventUnsubscribesRef.current = [];
      typingTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
      typingTimeoutsRef.current.clear();
      disconnectPusher();
      isInitializedRef.current = false;
    };
  }, [autoConnect, connect, currentCompanyId, fetchSyncStatus]);

  // Pusher is an update signal rather than the source of truth. Reconcile all
  // active chat state after a reconnect in case events arrived while offline.
  useEffect(() => {
    if (status === "connected") {
      fetchSyncStatus();
      reconcileRealtimeState(
        queryClientRef.current,
        useChatStore.getState().selectedConversationId,
      );
    }
  }, [status, fetchSyncStatus]);

  const contextValue: PusherContextValue = {
    status,
    isConnected: status === "connected",
    isConnecting: status === "connecting",
    error,
    syncingConnections,
    clearSyncingConnections,
    connect,
    disconnect,
    reconnect,
    subscribe,
    sendTypingStart,
    sendTypingStop,
    sendMarkAsRead,
  };

  return (
    <PusherContext.Provider value={contextValue}>
      {children}
    </PusherContext.Provider>
  );
}

/**
 * Hook to use Pusher context
 */
export function usePusherContext(): PusherContextValue {
  const context = useContext(PusherContext);
  if (!context) {
    throw new Error("usePusherContext must be used within a PusherProvider");
  }
  return context;
}

export { PusherProvider as RealtimeProvider };
export { usePusherContext as useRealtimeContext };
export type { PusherContextValue as RealtimeContextValue };
