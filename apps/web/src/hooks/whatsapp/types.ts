import type { WhatsAppConnection } from "@/lib/api";

/**
 * Per-connection state tracked in the hook
 */
export interface ConnectionState {
  qrCode: string | null;
  qrExpiresAt: Date | null;
  error: string | null;
  isConnecting: boolean;
  isDisconnecting: boolean;
}

/**
 * Combined connection data with local state
 */
export interface ConnectionWithState extends WhatsAppConnection {
  localState: ConnectionState;
}

/**
 * Pending connection state (before connection is created on server)
 */
export interface PendingConnection {
  qrCode: string | null;
  qrExpiresAt: Date | null;
  error: string | null;
  tempId: string | null;
}
