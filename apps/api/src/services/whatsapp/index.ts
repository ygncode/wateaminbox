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
  WhatsAppIdentityMismatchError,
} from "../../lib/errors.js";
// Connection management
export {
  getActiveConnection,
  getActiveConnections,
  getConnection,
  getConnectionLimits,
  getMaxConnections,
  killConnection,
  listArchivedConnections,
  listConnections,
  purgeArchivedConnection,
  relinkArchivedConnection,
  spawnConnection,
  type WhatsAppConnection,
} from "./connection.js";
export {
  claimConnectedSession,
  createConnectionSession,
  getActiveSessionId,
  resolveWhatsAppSession,
  updateSessionStatus,
} from "./session.js";
// Status tracking
export {
  type ConnectionStatus,
  getConnectionStatus,
  normalizeWhatsAppPhone,
  updateConnectionStatus,
  updateLastSync,
} from "./status.js";
