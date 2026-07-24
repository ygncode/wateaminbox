import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { nowMs, toDate } from "@wateaminbox/shared";
import type {
  QRCodePayload,
  WhatsAppConnectedPayload,
  WhatsAppDisconnectedPayload,
  WorkerConnectionStatusPayload,
} from "@wateaminbox/shared";
import { toast } from "sonner";
import { useRealtimeContext } from "@/contexts";
import { queryKeys } from "../query-keys";
import type { ConnectionState } from "./types";

interface UseRealtimeOptions {
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
  setQrTimeout: (
    connectionId: string,
    expiresIn: number,
    onExpire: () => void,
  ) => void;
  clearQrTimeout: (connectionId: string) => void;
}

/**
 * Hook for handling realtime events for WhatsApp connections
 */
export function useWhatsAppConnectionRealtime({
  updateConnectionState,
  setPendingConnection,
  setQrTimeout,
  clearQrTimeout,
}: UseRealtimeOptions) {
  const queryClient = useQueryClient();
  const { subscribe, isConnected: realtimeConnected } = useRealtimeContext();

  /**
   * Use refs to stabilize callback references for realtime subscriptions
   */
  const subscribeRef = useRef(subscribe);
  subscribeRef.current = subscribe;

  const updateConnectionStateRef = useRef(updateConnectionState);
  updateConnectionStateRef.current = updateConnectionState;

  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;

  const setQrTimeoutRef = useRef(setQrTimeout);
  setQrTimeoutRef.current = setQrTimeout;

  const clearQrTimeoutRef = useRef(clearQrTimeout);
  clearQrTimeoutRef.current = clearQrTimeout;

  // Handle realtime events for multi-connection
  useEffect(() => {
    if (!realtimeConnected) return;

    // Handle QR code events
    const unsubQr = subscribeRef.current<QRCodePayload>("qr", (payload) => {
      const connectionId = payload.connectionId;

      if (connectionId) {
        updateConnectionStateRef.current(connectionId, {
          qrCode: payload.qrCode,
          qrExpiresAt: toDate(payload.expiresAt),
          error: null,
          isConnecting: true,
        });

        // Set up QR expiration timeout
        const expiresIn =
          (toDate(payload.expiresAt)?.getTime() ?? nowMs()) - nowMs();
        setQrTimeoutRef.current(connectionId, expiresIn, () => {
          updateConnectionStateRef.current(connectionId, {
            qrCode: null,
            qrExpiresAt: null,
            error: "QR code expired. Please try again.",
            isConnecting: false,
          });
        });
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
          clearQrTimeoutRef.current(connectionId);

          // Refetch connections to get updated status
          queryClientRef.current.invalidateQueries({
            queryKey: queryKeys.whatsapp.lists(),
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
          clearQrTimeoutRef.current(connectionId);

          // Refetch connections
          queryClientRef.current.invalidateQueries({
            queryKey: queryKeys.whatsapp.lists(),
          });
        }
      },
    );

    // Handle worker connection status events (from orchestrator)
    // This is for worker crash/recovery notifications
    const unsubConnectionStatus =
      subscribeRef.current<WorkerConnectionStatusPayload>(
        "connection:status",
        (payload) => {
          const connectionId = payload.connectionId;
          if (connectionId) {
            const isError =
              payload.status === "error" || payload.status === "failed";

            updateConnectionStateRef.current(connectionId, {
              qrCode: null,
              qrExpiresAt: null,
              error: isError ? payload.reason : null,
              isConnecting: payload.status === "connecting",
              isDisconnecting: false,
            });

            // Show toast for error/failed states
            if (isError) {
              toast.error(payload.reason || "WhatsApp connection lost", {
                description: "Worker connection status",
              });
            }

            // Refetch connections to update status
            queryClientRef.current.invalidateQueries({
              queryKey: queryKeys.whatsapp.lists(),
            });
          }
        },
      );

    return () => {
      unsubQr();
      unsubConnected();
      unsubDisconnected();
      unsubConnectionStatus();
    };
  }, [realtimeConnected, setPendingConnection]);

  return { realtimeConnected };
}
