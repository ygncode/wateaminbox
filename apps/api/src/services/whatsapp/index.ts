/**
 * WhatsApp Service Module
 *
 * This barrel file re-exports all WhatsApp functionality from focused modules.
 * Import from this index for all WhatsApp operations.
 */

// Re-export error classes for convenience
export {
  ConnectionAlreadyExistsError,
  ConnectionNotFoundError,
  MaxConnectionsExceededError,
} from "../../lib/errors.js";
// Connection management
export {
  getActiveConnection,
  getActiveConnections,
  getConnection,
  getConnectionLimits,
  getMaxConnections,
  killConnection,
  listConnections,
  spawnConnection,
  type WhatsAppConnection,
} from "./connection.js";
// Status tracking
export {
  type ConnectionStatus,
  getConnectionStatus,
  updateConnectionStatus,
  updateLastSync,
} from "./status.js";
