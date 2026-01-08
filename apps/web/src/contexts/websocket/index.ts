/**
 * WebSocket context barrel export
 *
 * Exports types, utilities, and the main provider component.
 */

// Types
export type {
  SyncState,
  SyncStatusResponse,
  WebSocketContextValue,
  WebSocketProviderProps,
} from "./types";

// Event handlers
export { registerEventHandlers } from "./event-handlers";

// Sync manager
export { fetchSyncStatus, clearSyncingConnections } from "./sync-manager";

// Connection manager
export {
  initializeClient,
  connect,
  disconnect,
  reconnect,
  forceReconnectWithFreshCredentials,
  send,
} from "./connection-manager";
