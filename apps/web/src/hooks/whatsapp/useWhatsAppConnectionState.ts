import { useCallback, useRef, useState } from "react";
import type { ConnectionState } from "./types";

/**
 * Hook for managing local state for WhatsApp connections
 * (QR codes, errors, pending state, loading states)
 */
export function useWhatsAppConnectionState() {
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

  // Helper to remove connection from state
  const removeConnectionState = useCallback((connectionId: string) => {
    setConnectionStates((prev) => {
      const newState = { ...prev };
      delete newState[connectionId];
      return newState;
    });
  }, []);

  // Clear error for a connection
  const clearError = useCallback(
    (connectionId: string) => {
      updateConnectionState(connectionId, { error: null });
    },
    [updateConnectionState],
  );

  // Clear pending connection
  const clearPendingConnection = useCallback(() => {
    setPendingConnection(null);
  }, []);

  // Clear global error
  const clearGlobalError = useCallback(() => {
    setGlobalError(null);
  }, []);

  // Set a QR expiration timeout
  const setQrTimeout = useCallback(
    (
      connectionId: string,
      expiresIn: number,
      onExpire: () => void,
    ) => {
      // Clear existing timeout if any
      const existingTimeout = qrTimeoutsRef.current.get(connectionId);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }

      const timeout = setTimeout(() => {
        onExpire();
        qrTimeoutsRef.current.delete(connectionId);
      }, Math.max(expiresIn, 0));

      qrTimeoutsRef.current.set(connectionId, timeout);
    },
    [],
  );

  // Clear a QR expiration timeout
  const clearQrTimeout = useCallback((connectionId: string) => {
    const timeout = qrTimeoutsRef.current.get(connectionId);
    if (timeout) {
      clearTimeout(timeout);
      qrTimeoutsRef.current.delete(connectionId);
    }
  }, []);

  // Cleanup all timeouts
  const cleanupTimeouts = useCallback(() => {
    qrTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
    qrTimeoutsRef.current.clear();
  }, []);

  // Get connection state or default
  const getConnectionState = useCallback(
    (connectionId: string): ConnectionState => {
      return (
        connectionStates[connectionId] || {
          qrCode: null,
          qrExpiresAt: null,
          error: null,
          isConnecting: false,
          isDisconnecting: false,
        }
      );
    },
    [connectionStates],
  );

  return {
    // State
    connectionStates,
    pendingConnection,
    globalError,

    // State setters
    setPendingConnection,
    setGlobalError,

    // Actions
    updateConnectionState,
    removeConnectionState,
    clearError,
    clearPendingConnection,
    clearGlobalError,
    getConnectionState,

    // QR timeout management
    setQrTimeout,
    clearQrTimeout,
    cleanupTimeouts,
  };
}
