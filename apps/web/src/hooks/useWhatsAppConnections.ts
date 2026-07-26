import { useEffect } from "react";
import { queryKeys } from "./query-keys";
import {
  type ConnectionState,
  type ConnectionWithState,
  resolveConnectionQrState,
  useWhatsAppConnectionMutations,
  useWhatsAppConnectionRealtime,
  useWhatsAppConnectionState,
  useWhatsAppConnectionsList,
} from "./whatsapp";

/**
 * @deprecated Use `queryKeys.whatsapp` from `@/hooks/query-keys` instead.
 * Kept for backward compatibility.
 */
export const whatsappConnectionKeys = {
  all: queryKeys.whatsapp.all,
  list: () => queryKeys.whatsapp.lists(),
  detail: (id: string) => queryKeys.whatsapp.detail(id),
};

// Re-export types for backward compatibility
export type { ConnectionState, ConnectionWithState };

/**
 * Hook for listing and managing multiple WhatsApp connections.
 *
 * This hook composes several sub-hooks:
 * - useWhatsAppConnectionsList: Query for connections list
 * - useWhatsAppConnectionState: Local state management (QR codes, errors, pending)
 * - useWhatsAppConnectionMutations: Create/delete/reconnect/disconnect/rename
 * - useWhatsAppConnectionRealtime: realtime event handlers
 */
export function useWhatsAppConnections() {
  // Query for list of connections
  const {
    data: connections = [],
    isLoading,
    isError,
    error: queryError,
    refetch,
  } = useWhatsAppConnectionsList();

  // Local state management
  const {
    connectionStates,
    pendingConnection,
    globalError,
    setPendingConnection,
    setGlobalError,
    updateConnectionState,
    clearError,
    clearPendingConnection,
    clearGlobalError,
    setQrTimeout,
    clearQrTimeout,
    cleanupTimeouts,
  } = useWhatsAppConnectionState();

  // Mutations
  const {
    create,
    reconnect,
    disconnect,
    remove,
    rename,
    isCreating,
    isDeleting,
    isUpdating,
  } = useWhatsAppConnectionMutations({
    updateConnectionState,
    setPendingConnection,
    setGlobalError,
    clearQrTimeout,
  });

  // realtime handlers
  useWhatsAppConnectionRealtime({
    updateConnectionState,
    setPendingConnection,
    setQrTimeout,
    clearQrTimeout,
  });

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      cleanupTimeouts();
    };
  }, [cleanupTimeouts]);

  // Combine connections with their local state
  const connectionsWithState: ConnectionWithState[] = connections.map(
    (connection) => {
      const local = connectionStates[connection.id];
      const persistedQrExpiresAt = connection.qrExpiresAt
        ? new Date(connection.qrExpiresAt)
        : null;

      const qrState = resolveConnectionQrState(
        local,
        connection.qrCode,
        persistedQrExpiresAt,
        connection.status,
      );
      return {
        ...connection,
        // Persisted QR data covers missed realtime events, but an explicit
        // local clear after connection must never resurrect an old code.
        localState: {
          ...qrState,
          error: local?.error ?? null,
          isConnecting: local?.isConnecting ?? connection.status === "pending",
          isDisconnecting: local?.isDisconnecting ?? false,
        },
      };
    },
  );

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
    isCreating,
    isDeleting,
    isUpdating,

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

/**
 * Hook for managing a single connection (useful for detail views)
 */
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
