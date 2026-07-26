/**
 * WhatsApp connection-related hooks
 *
 * This barrel file exports all WhatsApp sub-hooks for organized imports.
 * The main useWhatsAppConnections.ts composes these hooks together.
 */

// Re-export WhatsAppConnection type from API
export type { WhatsAppConnection } from "@/lib/api/types";
export type {
  ConnectionState,
  ConnectionWithState,
  PendingConnection,
} from "./types";
// Types
export { resolveConnectionQrState } from "./types";
export { useWhatsAppConnectionMutations } from "./useWhatsAppConnectionMutations";
export { useWhatsAppConnectionRealtime } from "./useWhatsAppConnectionRealtime";
export { useWhatsAppConnectionState } from "./useWhatsAppConnectionState";
// Sub-hooks
export { useWhatsAppConnectionsList } from "./useWhatsAppConnectionsList";
