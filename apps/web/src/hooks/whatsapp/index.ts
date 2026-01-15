/**
 * WhatsApp connection-related hooks
 *
 * This barrel file exports all WhatsApp sub-hooks for organized imports.
 * The main useWhatsAppConnections.ts composes these hooks together.
 */

// Types
export type {
  ConnectionState,
  ConnectionWithState,
  PendingConnection,
} from "./types";

// Sub-hooks
export { useWhatsAppConnectionsList } from "./useWhatsAppConnectionsList";
export { useWhatsAppConnectionMutations } from "./useWhatsAppConnectionMutations";
export { useWhatsAppConnectionState } from "./useWhatsAppConnectionState";
export { useWhatsAppConnectionWebSocket } from "./useWhatsAppConnectionWebSocket";

// Re-export WhatsAppConnection type from API
export type { WhatsAppConnection } from "@/lib/api/types";
