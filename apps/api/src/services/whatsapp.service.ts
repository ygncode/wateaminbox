/**
 * WhatsApp Service
 *
 * This file re-exports all WhatsApp functionality from the modular structure
 * in ./whatsapp/ for backward compatibility.
 *
 * New code should import directly from '@/services/whatsapp/index.js' or
 * use specific module imports like '@/services/whatsapp/connection.js'.
 *
 * @module whatsapp.service
 */

// Re-export everything from the modular structure
export {
  // Error classes
  ConnectionAlreadyExistsError,
  ConnectionNotFoundError,
  type ConnectionStatus,
  claimConnectedSession,
  createConnectionSession,
  getActiveConnection,
  getActiveConnections,
  getActiveSessionId,
  getConnection,
  getConnectionLimits,
  // Status tracking
  getConnectionStatus,
  // Connection management
  getMaxConnections,
  killConnection,
  listArchivedConnections,
  listConnections,
  MaxConnectionsExceededError,
  normalizeWhatsAppPhone,
  purgeArchivedConnection,
  relinkArchivedConnection,
  resolveWhatsAppSession,
  spawnConnection,
  updateConnectionStatus,
  updateLastSync,
  updateSessionStatus,
  // Types
  type WhatsAppConnection,
} from "./whatsapp/index.js";
