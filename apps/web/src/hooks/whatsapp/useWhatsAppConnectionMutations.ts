import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { nowMs } from "@whatsapp-web/shared";
import { ApiRequestError } from "@/lib/api/client";
import {
  createWhatsAppConnection,
  deleteWhatsAppConnection,
  disconnectWhatsAppConnection,
  reconnectWhatsAppConnection,
  updateWhatsAppConnection,
} from "@/lib/api/whatsapp";
import type { WhatsAppConnection } from "@/lib/api/types";
import { queryKeys } from "../query-keys";
import type { ConnectionState } from "./types";

interface UseMutationsOptions {
  updateConnectionState: (
    connectionId: string,
    updates: Partial<ConnectionState>,
  ) => void;
  setPendingConnection: React.Dispatch<
    React.SetStateAction<{
      qrCode: string | null;
      qrExpiresAt: Date | null;
      error: string | null;
      tempId: string | null;
    } | null>
  >;
  setGlobalError: React.Dispatch<React.SetStateAction<string | null>>;
  clearQrTimeout: (connectionId: string) => void;
}

/**
 * Hook for WhatsApp connection mutations (create, delete, reconnect, disconnect, rename)
 */
export function useWhatsAppConnectionMutations({
  updateConnectionState,
  setPendingConnection,
  setGlobalError,
  clearQrTimeout,
}: UseMutationsOptions) {
  const queryClient = useQueryClient();

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
      const connectionId = connection.id;
      setPendingConnection(null);
      updateConnectionState(connectionId, {
        qrCode: null,
        qrExpiresAt: null,
        error: null,
        isConnecting: true,
        isDisconnecting: false,
      });

      // Optimistically add the new connection to the React Query cache
      queryClient.setQueryData<WhatsAppConnection[]>(
        queryKeys.whatsapp.lists(),
        (oldConnections = []) => {
          if (oldConnections.some((c) => c.id === connectionId)) {
            return oldConnections;
          }
          return [...oldConnections, connection];
        },
      );

      // Also invalidate to ensure we eventually get fresh data from server
      queryClient.invalidateQueries({
        queryKey: queryKeys.whatsapp.lists(),
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
        queryKey: queryKeys.whatsapp.lists(),
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
        queryKey: queryKeys.whatsapp.lists(),
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
      updateConnectionState(connectionId, {
        qrCode: null,
        qrExpiresAt: null,
        error: null,
        isConnecting: false,
        isDisconnecting: false,
      });
      // Clear any QR timeout
      clearQrTimeout(connectionId);
      // Invalidate list
      queryClient.invalidateQueries({
        queryKey: queryKeys.whatsapp.lists(),
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
        queryKey: queryKeys.whatsapp.lists(),
      });
    },
  });

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

  return {
    create,
    reconnect,
    disconnect,
    remove,
    rename,
    isCreating: createMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isUpdating: updateMutation.isPending,
  };
}
