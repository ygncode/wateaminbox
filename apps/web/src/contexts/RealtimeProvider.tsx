/**
 * Realtime Provider
 *
 * Provides real-time communication through Centrifugo.
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
  bindUserEvent,
  type CompanyRealtimeEventType,
  connectRealtime,
  disconnectRealtime,
  getConnectionState,
  initializeRealtime,
  onConnectionStateChange,
  type RealtimeConnectionStatus,
  type RealtimeEventData,
  subscribeToCompany,
  subscribeToUser,
  unsubscribeFromCompany,
} from "../lib/realtime";
import { useChatStore } from "../stores/chat-store";
import { useAuth } from "./auth-context";
import {
  reconcileRealtimeState,
  registerRealtimeEventHandlers,
  type SyncState,
} from "./realtime/event-handlers";
import { reconcileSyncState } from "./realtime/sync-state";
import { useWorkspace } from "./workspace-context";

// Typing timeout in milliseconds
const TYPING_TIMEOUT = 5000;
const REALTIME_RECONCILE_INTERVAL = 60_000;

export type { SyncState } from "./realtime/event-handlers";

/**
 * Event handler type for subscribe function (backward compatibility)
 */
type EventHandler<T = unknown> = (payload: T) => void;

/**
 * Context value for Realtime provider
 */
export interface RealtimeContextValue {
  // Connection state
  status: RealtimeConnectionStatus;
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
  subscribeUser: <T>(
    eventType: "notification:new",
    handler: EventHandler<T>,
  ) => () => void;

  // Messaging methods
  sendTypingStart: (conversationId: string, contactId: string) => void;
  sendTypingStop: (conversationId: string, contactId: string) => void;
  sendMarkAsRead: (conversationId: string, messageIds: string[]) => void;
}

interface RealtimeProviderProps {
  children: React.ReactNode;
  autoConnect?: boolean;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export function RealtimeProvider({
  children,
  autoConnect = true,
}: RealtimeProviderProps) {
  const [status, setStatus] =
    useState<RealtimeConnectionStatus>("disconnected");
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
  const { user } = useAuth();
  const { activeWorkspaceId: currentCompanyId } = useWorkspace();

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

  // Register all company-scoped Realtime event handlers.
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

  // Connect to Realtime
  const connect = useCallback(() => {
    if (!currentCompanyId) {
      return;
    }

    try {
      initializeRealtime();
      subscribeToCompany(currentCompanyId);
      if (user) subscribeToUser(currentCompanyId, user.id);
      registerEventHandlers();
    } catch (connectionError) {
      setStatus("disconnected");
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
      } else if (state === "disconnected") {
        setError("Realtime connection disconnected");
      }
    });

    eventUnsubscribesRef.current.push(unsub);
    connectRealtime();

    // Set initial state
    setStatus(getConnectionState());
  }, [currentCompanyId, registerEventHandlers, user]);

  // Disconnect from Realtime
  const disconnect = useCallback(() => {
    eventUnsubscribesRef.current.forEach((unsub) => unsub());
    eventUnsubscribesRef.current = [];
    unsubscribeFromCompany();
    disconnectRealtime();
    setStatus("disconnected");
  }, []);

  // Reconnect to Realtime
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
          sync_message_count: number;
          sync_conversation_count: number;
          updated_at: string | null;
        }>;
      }>("/whatsapp/sync-status");

      const activeConnections = response.connections
        .filter((connection) => connection.sync_status === "syncing")
        .map(
          ({
            id,
            updated_at,
            sync_message_count,
            sync_conversation_count,
          }) => ({
            id,
            updated_at,
            sync_message_count,
            sync_conversation_count,
          }),
        );
      setSyncingConnections((previous) =>
        reconcileSyncState(previous, activeConnections),
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch sync status",
      );
    }
  }, [currentCompanyId]);

  // Realtime is only an update signal. While an overlay is active, periodically
  // reconcile with PostgreSQL so a missed completion can never strand the UI.
  useEffect(() => {
    if (syncingConnections.size === 0) return;
    const interval = setInterval(fetchSyncStatus, 15_000);
    return () => clearInterval(interval);
  }, [fetchSyncStatus, syncingConnections.size]);

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
      const wrappedHandler = (data: RealtimeEventData<T>) => {
        const payload = {
          ...data.payload,
          connectionId: data.connectionId,
        } as T;
        handler(payload);
      };
      return bindEvent(eventType as CompanyRealtimeEventType, wrappedHandler);
    },
    [],
  );

  const subscribeUser = useCallback(
    <T,>(
      eventType: "notification:new",
      handler: EventHandler<T>,
    ): (() => void) =>
      bindUserEvent(eventType, (data: RealtimeEventData<T>) =>
        handler(data.payload),
      ),
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
      disconnectRealtime();
      isInitializedRef.current = false;
    };
  }, [autoConnect, connect, currentCompanyId, fetchSyncStatus]);

  // Realtime is an update signal rather than the source of truth. Reconcile all
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

  // Centrifugo is intentionally an update signal without message history.
  // Periodic reconciliation bounds how long a connected client can remain
  // stale if an API-to-Centrifugo publication fails without dropping the
  // browser's WebSocket connection.
  useEffect(() => {
    if (status !== "connected") return;
    const interval = setInterval(() => {
      reconcileRealtimeState(
        queryClientRef.current,
        useChatStore.getState().selectedConversationId,
      );
    }, REALTIME_RECONCILE_INTERVAL);
    return () => clearInterval(interval);
  }, [status]);

  const contextValue: RealtimeContextValue = {
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
    subscribeUser,
    sendTypingStart,
    sendTypingStop,
    sendMarkAsRead,
  };

  return (
    <RealtimeContext.Provider value={contextValue}>
      {children}
    </RealtimeContext.Provider>
  );
}

/**
 * Hook to use Realtime context
 */
export function useRealtimeContext(): RealtimeContextValue {
  const context = useContext(RealtimeContext);
  if (!context) {
    throw new Error(
      "useRealtimeContext must be used within a RealtimeProvider",
    );
  }
  return context;
}
