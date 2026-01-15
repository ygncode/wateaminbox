import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWebSocketContext } from "../contexts/WebSocketProvider";
import {
  connectWhatsApp,
  disconnectWhatsApp,
  getWhatsAppStatus,
} from "../lib/api";
import type {
  QRCodePayload,
  WhatsAppConnectedPayload,
  WhatsAppDisconnectedPayload,
} from "../lib/websocket";

export type WhatsAppConnectionState =
  | "disconnected"
  | "connecting"
  | "waiting_qr"
  | "scanning"
  | "connected"
  | "error";

export interface WhatsAppConnection {
  // State
  state: WhatsAppConnectionState;
  qrCode: string | null;
  qrExpiresAt: Date | null;
  phoneNumber: string | null;
  jid: string | null;
  error: string | null;
  lastSync: Date | null;

  // Actions
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  refresh: () => Promise<void>;

  // Loading states
  isConnecting: boolean;
  isDisconnecting: boolean;
  isLoading: boolean;
}

export function useWhatsAppConnection(): WhatsAppConnection {
  const queryClient = useQueryClient();
  const { subscribe, isConnected: wsConnected } = useWebSocketContext();

  // Local state for QR code and connection events
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [qrExpiresAt, setQrExpiresAt] = useState<Date | null>(null);
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [jid, setJid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectionState, setConnectionState] =
    useState<WhatsAppConnectionState>("disconnected");

  // Track if we've started the connection process
  const isConnectingRef = useRef(false);
  // Track if we've already triggered auto-connect for pending status
  const hasTriggeredAutoConnectRef = useRef(false);
  // Track timeout for waiting_qr state
  const waitingQrTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // Query for initial status
  const {
    data: status,
    isLoading: isStatusLoading,
    refetch: refetchStatus,
  } = useQuery({
    queryKey: ["whatsapp", "status"],
    queryFn: getWhatsAppStatus,
    staleTime: 30000, // 30 seconds
    gcTime: 300000, // 5 minutes
    refetchInterval: 60000, // Refetch every minute
  });

  // Connect mutation
  const connectMutation = useMutation({
    mutationFn: connectWhatsApp,
    onSuccess: () => {
      setError(null);
      setConnectionState("waiting_qr");
      isConnectingRef.current = true;
    },
    onError: (err: Error) => {
      setError(err.message);
      setConnectionState("error");
      isConnectingRef.current = false;
    },
  });

  // Disconnect mutation
  const disconnectMutation = useMutation({
    mutationFn: disconnectWhatsApp,
    onSuccess: () => {
      setQrCode(null);
      setQrExpiresAt(null);
      setPhoneNumber(null);
      setJid(null);
      setError(null);
      setConnectionState("disconnected");
      isConnectingRef.current = false;
      queryClient.invalidateQueries({ queryKey: ["whatsapp", "status"] });
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  // Handle QR code events from WebSocket
  useEffect(() => {
    if (!wsConnected) return;

    const unsubQr = subscribe<QRCodePayload>("qr", (payload) => {
      setQrCode(payload.qrCode);
      setQrExpiresAt(new Date(payload.expiresAt));
      setConnectionState("scanning");
      setError(null);
    });

    const unsubConnected = subscribe<WhatsAppConnectedPayload>(
      "connected",
      (payload) => {
        setQrCode(null);
        setQrExpiresAt(null);
        setPhoneNumber(payload.phoneNumber);
        setJid(payload.jid);
        setConnectionState("connected");
        setError(null);
        isConnectingRef.current = false;
        queryClient.invalidateQueries({ queryKey: ["whatsapp", "status"] });
      },
    );

    const unsubDisconnected = subscribe<WhatsAppDisconnectedPayload>(
      "disconnected",
      (payload) => {
        setQrCode(null);
        setQrExpiresAt(null);
        setPhoneNumber(null);
        setJid(null);
        setConnectionState("disconnected");
        isConnectingRef.current = false;
        if (payload.reason) {
          setError(`Disconnected: ${payload.reason}`);
        }
        queryClient.invalidateQueries({ queryKey: ["whatsapp", "status"] });
      },
    );

    return () => {
      unsubQr();
      unsubConnected();
      unsubDisconnected();
    };
  }, [wsConnected, subscribe, queryClient]);

  // Sync state from initial status query
  useEffect(() => {
    if (status && !isConnectingRef.current) {
      if (status.status === "connected") {
        setPhoneNumber(status.phoneNumber ?? null);
        setJid(status.jid ?? null);
        setConnectionState("connected");
        hasTriggeredAutoConnectRef.current = false;
      } else if (status.status === "pending") {
        setConnectionState("waiting_qr");
        // If pending, trigger connect to ensure spawn command is published
        // This handles the case where the worker isn't running
        if (
          wsConnected &&
          !connectMutation.isPending &&
          !hasTriggeredAutoConnectRef.current
        ) {
          hasTriggeredAutoConnectRef.current = true;
          connectMutation.mutate();
        }
      } else {
        setConnectionState("disconnected");
        hasTriggeredAutoConnectRef.current = false;
      }
    }
  }, [status, wsConnected, connectMutation]);

  // Timeout for waiting_qr state - if QR code doesn't arrive in 30 seconds, show error
  useEffect(() => {
    // Clear any existing timeout
    if (waitingQrTimeoutRef.current) {
      clearTimeout(waitingQrTimeoutRef.current);
      waitingQrTimeoutRef.current = null;
    }

    if (connectionState === "waiting_qr") {
      waitingQrTimeoutRef.current = setTimeout(() => {
        setError(
          "QR code generation timed out. Please check that all services are running and try again.",
        );
        setConnectionState("error");
        isConnectingRef.current = false;
      }, 30000); // 30 second timeout
    }

    return () => {
      if (waitingQrTimeoutRef.current) {
        clearTimeout(waitingQrTimeoutRef.current);
        waitingQrTimeoutRef.current = null;
      }
    };
  }, [connectionState]);

  // QR code expiry timeout
  useEffect(() => {
    if (!qrExpiresAt) return;

    const timeout = setTimeout(() => {
      if (connectionState === "scanning") {
        setQrCode(null);
        setQrExpiresAt(null);
        setError("QR code expired. Please try again.");
        setConnectionState("error");
      }
    }, qrExpiresAt.getTime() - Date.now());

    return () => clearTimeout(timeout);
  }, [qrExpiresAt, connectionState]);

  // Actions
  const connect = useCallback(async () => {
    setError(null);
    setConnectionState("connecting");
    await connectMutation.mutateAsync();
  }, [connectMutation]);

  const disconnect = useCallback(async () => {
    await disconnectMutation.mutateAsync();
  }, [disconnectMutation]);

  const refresh = useCallback(async () => {
    await refetchStatus();
  }, [refetchStatus]);

  return {
    state: connectionState,
    qrCode,
    qrExpiresAt,
    phoneNumber,
    jid,
    error,
    lastSync: status?.lastSync ? new Date(status.lastSync) : null,
    connect,
    disconnect,
    refresh,
    isConnecting: connectMutation.isPending,
    isDisconnecting: disconnectMutation.isPending,
    isLoading: isStatusLoading,
  };
}

export default useWhatsAppConnection;
