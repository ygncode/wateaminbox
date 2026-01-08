/**
 * WhatsApp Service Module
 *
 * This barrel file re-exports all WhatsApp functionality from focused modules.
 * Import from this index for all WhatsApp operations.
 */

// Connection management
export {
  type WhatsAppConnection,
  getMaxConnections,
  listConnections,
  getConnection,
  spawnConnection,
  killConnection,
  getActiveConnection,
  getActiveConnections,
  getConnectionLimits,
} from "./connection.js";

// Messaging
export { type SendMessageInput, sendMessage } from "./messaging.js";

// Status tracking
export {
  type ConnectionStatus,
  getConnectionStatus,
  updateConnectionStatus,
  updateLastSync,
} from "./status.js";

// Re-export error classes for convenience
export {
  ConnectionAlreadyExistsError,
  ConnectionNotFoundError,
  InvalidConnectionStateError,
  MaxConnectionsExceededError,
} from "../../lib/errors.js";
