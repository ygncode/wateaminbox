import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { nowMs, toDate } from "@whatsapp-web/shared";
import { useWebSocketContext } from "@/contexts/WebSocketProvider";
import type {
  QRCodePayload,
  WhatsAppConnectedPayload,
  WhatsAppDisconnectedPayload,
} from "@/lib/websocket";
import { queryKeys } from "../query-keys";
import type { ConnectionState } from "./types";

interface UseWebSocketOptions {
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
 * Hook for handling WebSocket events for WhatsApp connections
 */
export function useWhatsAppConnectionWebSocket({
  updateConnectionState,
  setPendingConnection,
  setQrTimeout,
  clearQrTimeout,
}: UseWebSocketOptions) {
  const queryClient = useQueryClient();
  const { subscribe, isConnected: wsConnected } = useWebSocketContext();

  /**
   * Use refs to stabilize callback references for WebSocket subscriptions
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

  // Handle WebSocket events for multi-connection
  useEffect(() => {
    if (!wsConnected) return;

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

    return () => {
      unsubQr();
      unsubConnected();
      unsubDisconnected();
    };
  }, [wsConnected, setPendingConnection]);

  return { wsConnected };
}
