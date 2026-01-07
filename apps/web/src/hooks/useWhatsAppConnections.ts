import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { nowMs, toDate } from "@whatsapp-web/shared";
import { useWebSocketContext } from "../contexts/WebSocketProvider";
import {
  ApiRequestError,
  createWhatsAppConnection,
  deleteWhatsAppConnection,
  disconnectWhatsAppConnection,
  listWhatsAppConnections,
  reconnectWhatsAppConnection,
  updateWhatsAppConnection,
  type WhatsAppConnection,
} from "../lib/api";
import type {
  QRCodePayload,
  WhatsAppConnectedPayload,
  WhatsAppDisconnectedPayload,
} from "../lib/websocket";

// Query keys for multi-connection management
export const whatsappConnectionKeys = {
  all: ["whatsapp", "connections"] as const,
  list: () => [...whatsappConnectionKeys.all, "list"] as const,
  detail: (id: string) =>
    [...whatsappConnectionKeys.all, "detail", id] as const,
};

// Per-connection state tracked in the hook
export interface ConnectionState {
  qrCode: string | null;
  qrExpiresAt: Date | null;
  error: string | null;
  isConnecting: boolean;
  isDisconnecting: boolean;
}

// Combined connection data with local state
export interface ConnectionWithState extends WhatsAppConnection {
  localState: ConnectionState;
}

// Hook for listing and managing multiple WhatsApp connections
export function useWhatsAppConnections() {
  const queryClient = useQueryClient();
  const { subscribe, isConnected: wsConnected } = useWebSocketContext();

  // Track per-connection local state (QR codes, errors, loading states)
  const [connectionStates, setConnectionStates] = useState<
    Record<string, ConnectionState>
  >({});

  // Track pending connection (one being created that doesn't have an ID yet)
  const [pendingConnection, setPendingConnection] = useState<{
    qrCode: string | null;
    qrExpiresAt: Date | null;
    error: string | null;
    tempId: string | null;
  } | null>(null);

  // Track global error (e.g., max connections exceeded)
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Track timeout refs for QR expiration
  const qrTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  /**
   * Use refs to stabilize callback references for WebSocket subscriptions
   *
   * Problem: The `subscribe` function from WebSocketContext changes reference
   * when its dependencies change, which would cause the subscription effect
   * to re-run and create duplicate handlers.
   *
   * Solution: Store `subscribe` in a ref and update it on each render.
   * The effect only depends on `wsConnected`, so it only re-runs when
   * connection state actually changes.
   */
  const subscribeRef = useRef(subscribe);
  subscribeRef.current = subscribe;

  // Query for list of connections
  const {
    data: connections = [],
    isLoading,
    isError,
    error: queryError,
    refetch,
  } = useQuery({
    queryKey: whatsappConnectionKeys.list(),
    queryFn: listWhatsAppConnections,
    staleTime: 30000, // 30 seconds
    refetchInterval: 60000, // Refetch every minute
  });

  // Helper to update connection state
  const updateConnectionState = useCallback(
    (connectionId: string, updates: Partial<ConnectionState>) => {
      setConnectionStates((prev) => ({
        ...prev,
        [connectionId]: {
          ...(prev[connectionId] || {
            qrCode: null,
            qrExpiresAt: null,
            error: null,
            isConnecting: false,
            isDisconnecting: false,
          }),
          ...updates,
        },
      }));
    },
    [],
  );

  // Create connection mutation
  const createMutation = useMutation({
    mutationFn: (name?: string) => createWhatsAppConnection(name),
    onMutate: () => {
      // Set up pending connection state
      setPendingConnection({
        qrCode: null,
        qrExpiresAt: null,
        error: null,
        tempId: `temp-${nowMs()}`,
      });
    },
    onSuccess: (connection) => {
      // Clear pending state and set up the new connection's state
      // Note: fetchWithAuth unwraps { success, data } so connection is already the data object
      const connectionId = connection.id;
      setPendingConnection(null);
      updateConnectionState(connectionId, {
        qrCode: null,
        qrExpiresAt: null,
        error: null,
        isConnecting: true,
        isDisconnecting: false,
      });

      /**
       * Optimistically add the new connection to the React Query cache
       *
       * Why this is needed:
       * 1. API returns new connection → onSuccess fires
       * 2. We call invalidateQueries() which triggers a background refetch
       * 3. Meanwhile, Go service generates QR code and broadcasts via WebSocket
       * 4. QR event arrives and updates connectionStates[connectionId]
       * 5. BUT if the refetch hasn't completed, `connections` array doesn't
       *    include the new connection yet!
       * 6. connectionsWithState won't show the QR code because the connection
       *    isn't in the list to merge with its local state
       *
       * Solution: Immediately add the connection to cache so it's available
       * when the QR code arrives, regardless of refetch timing.
       */
      queryClient.setQueryData<WhatsAppConnection[]>(
        whatsappConnectionKeys.list(),
        (oldConnections = []) => {
          if (oldConnections.some((c) => c.id === connectionId)) {
            return oldConnections;
          }
          return [...oldConnections, connection];
        },
      );

      // Also invalidate to ensure we eventually get fresh data from server
      queryClient.invalidateQueries({
        queryKey: whatsappConnectionKeys.list(),
      });
    },
    onError: (error: Error) => {
      let errorMessage = error.message;

      // Handle max connections exceeded error (429)
      if (error instanceof ApiRequestError && error.statusCode === 429) {
        errorMessage =
          "You've reached the maximum number of WhatsApp connections allowed for your plan. Please disconnect an existing connection or upgrade your plan.";
        setGlobalError(errorMessage);
      }

      setPendingConnection((prev) =>
        prev ? { ...prev, error: errorMessage } : null,
      );
    },
  });

  // Reconnect connection mutation
  const reconnectMutation = useMutation({
    mutationFn: (connectionId: string) =>
      reconnectWhatsAppConnection(connectionId),
    onMutate: (connectionId) => {
      updateConnectionState(connectionId, {
        isConnecting: true,
        error: null,
      });
    },
    onSuccess: (_data, connectionId) => {
      updateConnectionState(connectionId, {
        isConnecting: true,
      });
      queryClient.invalidateQueries({
        queryKey: whatsappConnectionKeys.list(),
      });
    },
    onError: (error: Error, connectionId) => {
      updateConnectionState(connectionId, {
        isConnecting: false,
        error: error.message,
      });
    },
  });

  // Disconnect connection mutation
  const disconnectMutation = useMutation({
    mutationFn: (connectionId: string) =>
      disconnectWhatsAppConnection(connectionId),
    onMutate: (connectionId) => {
      updateConnectionState(connectionId, {
        isDisconnecting: true,
        error: null,
      });
    },
    onSuccess: (_data, connectionId) => {
      updateConnectionState(connectionId, {
        qrCode: null,
        qrExpiresAt: null,
        isConnecting: false,
        isDisconnecting: false,
      });
      queryClient.invalidateQueries({
        queryKey: whatsappConnectionKeys.list(),
      });
    },
    onError: (error: Error, connectionId) => {
      updateConnectionState(connectionId, {
        isDisconnecting: false,
        error: error.message,
      });
    },
  });

  // Delete connection mutation
  const deleteMutation = useMutation({
    mutationFn: (connectionId: string) =>
      deleteWhatsAppConnection(connectionId),
    onSuccess: (_data, connectionId) => {
      // Remove from local state
      setConnectionStates((prev) => {
        const newState = { ...prev };
        delete newState[connectionId];
        return newState;
      });
      // Clear any QR timeout
      const timeout = qrTimeoutsRef.current.get(connectionId);
      if (timeout) {
        clearTimeout(timeout);
        qrTimeoutsRef.current.delete(connectionId);
      }
      // Invalidate list
      queryClient.invalidateQueries({
        queryKey: whatsappConnectionKeys.list(),
      });
    },
  });

  // Update connection mutation
  const updateMutation = useMutation({
    mutationFn: ({
      connectionId,
      data,
    }: {
      connectionId: string;
      data: { name?: string };
    }) => updateWhatsAppConnection(connectionId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: whatsappConnectionKeys.list(),
      });
    },
  });

  // Store refs for callbacks used in WebSocket handlers
  const updateConnectionStateRef = useRef(updateConnectionState);
  updateConnectionStateRef.current = updateConnectionState;

  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;

  // Handle WebSocket events for multi-connection
  // Use refs to avoid stale closures and ensure handlers always use latest values
  useEffect(() => {
    if (!wsConnected) return;

    // Handle QR code events
    const unsubQr = subscribeRef.current<QRCodePayload>("qr", (payload) => {
      // Ensure we can correlate by connectionId; ignore if missing
      const connectionId = payload.connectionId;

      if (connectionId) {
        updateConnectionStateRef.current(connectionId, {
          qrCode: payload.qrCode,
          qrExpiresAt: toDate(payload.expiresAt),
          error: null,
          isConnecting: true,
        });

        // Set up QR expiration timeout
        const existingTimeout = qrTimeoutsRef.current.get(connectionId);
        if (existingTimeout) {
          clearTimeout(existingTimeout);
        }

        const expiresIn =
          (toDate(payload.expiresAt)?.getTime() ?? nowMs()) - nowMs();
        const timeout = setTimeout(
          () => {
            updateConnectionStateRef.current(connectionId, {
              qrCode: null,
              qrExpiresAt: null,
              error: "QR code expired. Please try again.",
              isConnecting: false,
            });
            qrTimeoutsRef.current.delete(connectionId);
          },
          Math.max(expiresIn, 0),
        );
        qrTimeoutsRef.current.set(connectionId, timeout);
      } else {
        // If no connectionId, stash on pending placeholder so UI can still show
        setPendingConnection((prev) =>
          prev
            ? {
                ...prev,
                qrCode: payload.qrCode,
                qrExpiresAt: toDate(payload.expiresAt),
              }
            : {
                qrCode: payload.qrCode,
                qrExpiresAt: toDate(payload.expiresAt),
                error: null,
                tempId: `temp-${nowMs()}`,
              },
        );
      }
    });

    // Handle connected events
    const unsubConnected = subscribeRef.current<WhatsAppConnectedPayload>(
      "connected",
      (payload) => {
        const connectionId = payload.connectionId;
        if (connectionId) {
          // Clear QR and update state
          updateConnectionStateRef.current(connectionId, {
            qrCode: null,
            qrExpiresAt: null,
            error: null,
            isConnecting: false,
          });

          // Clear QR timeout
          const timeout = qrTimeoutsRef.current.get(connectionId);
          if (timeout) {
            clearTimeout(timeout);
            qrTimeoutsRef.current.delete(connectionId);
          }

          // Refetch connections to get updated status
          queryClientRef.current.invalidateQueries({
            queryKey: whatsappConnectionKeys.list(),
          });
        }
      },
    );

    // Handle disconnected events
    const unsubDisconnected = subscribeRef.current<WhatsAppDisconnectedPayload>(
      "disconnected",
      (payload) => {
        const connectionId = payload.connectionId;
        if (connectionId) {
          updateConnectionStateRef.current(connectionId, {
            qrCode: null,
            qrExpiresAt: null,
            error: payload.reason ? `Disconnected: ${payload.reason}` : null,
            isConnecting: false,
            isDisconnecting: false,
          });

          // Clear QR timeout
          const timeout = qrTimeoutsRef.current.get(connectionId);
          if (timeout) {
            clearTimeout(timeout);
            qrTimeoutsRef.current.delete(connectionId);
          }

          // Refetch connections
          queryClientRef.current.invalidateQueries({
            queryKey: whatsappConnectionKeys.list(),
          });
        }
      },
    );

    return () => {
      unsubQr();
      unsubConnected();
      unsubDisconnected();
    };
  }, [wsConnected]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      qrTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
      qrTimeoutsRef.current.clear();
    };
  }, []);

  // Combine connections with their local state
  const connectionsWithState: ConnectionWithState[] = connections.map(
    (connection) => ({
      ...connection,
      localState: connectionStates[connection.id] || {
        qrCode: null,
        qrExpiresAt: null,
        error: null,
        isConnecting: false,
        isDisconnecting: false,
      },
    }),
  );

  // Actions
  const create = useCallback(
    async (name?: string) => {
      return createMutation.mutateAsync(name);
    },
    [createMutation],
  );

  const reconnect = useCallback(
    async (connectionId: string) => {
      return reconnectMutation.mutateAsync(connectionId);
    },
    [reconnectMutation],
  );

  const disconnect = useCallback(
    async (connectionId: string) => {
      return disconnectMutation.mutateAsync(connectionId);
    },
    [disconnectMutation],
  );

  const remove = useCallback(
    async (connectionId: string) => {
      return deleteMutation.mutateAsync(connectionId);
    },
    [deleteMutation],
  );

  const rename = useCallback(
    async (connectionId: string, name: string) => {
      return updateMutation.mutateAsync({ connectionId, data: { name } });
    },
    [updateMutation],
  );

  const clearError = useCallback(
    (connectionId: string) => {
      updateConnectionState(connectionId, { error: null });
    },
    [updateConnectionState],
  );

  const clearPendingConnection = useCallback(() => {
    setPendingConnection(null);
  }, []);

  const clearGlobalError = useCallback(() => {
    setGlobalError(null);
  }, []);

  return {
    // Data
    connections: connectionsWithState,
    pendingConnection,
    globalError,

    // Query state
    isLoading,
    isError,
    error: queryError,

    // Mutation loading states
    isCreating: createMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isUpdating: updateMutation.isPending,

    // Actions
    create,
    reconnect,
    disconnect,
    remove,
    rename,
    refresh: refetch,
    clearError,
    clearPendingConnection,
    clearGlobalError,

    // Derived state
    connectedCount: connections.filter((c) => c.status === "connected").length,
    totalCount: connections.length,
  };
}

// Hook for managing a single connection (useful for detail views)
export function useWhatsAppConnectionDetail(connectionId: string) {
  const { connections, reconnect, disconnect, remove, rename, clearError } =
    useWhatsAppConnections();

  const connection = connections.find((c) => c.id === connectionId);

  return {
    connection,
    reconnect: () => reconnect(connectionId),
    disconnect: () => disconnect(connectionId),
    remove: () => remove(connectionId),
    rename: (name: string) => rename(connectionId, name),
    clearError: () => clearError(connectionId),
  };
}

export default useWhatsAppConnections;
