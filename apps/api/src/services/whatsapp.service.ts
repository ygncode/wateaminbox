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
  // Types
  type WhatsAppConnection,
  type SendMessageInput,
  type ConnectionStatus,

  // Connection management
  getMaxConnections,
  listConnections,
  getConnection,
  spawnConnection,
  killConnection,
  getActiveConnection,
  getActiveConnections,
  getConnectionLimits,

  // Messaging
  sendMessage,

  // Status tracking
  getConnectionStatus,
  updateConnectionStatus,
  updateLastSync,

  // Error classes
  ConnectionAlreadyExistsError,
  ConnectionNotFoundError,
  InvalidConnectionStateError,
  MaxConnectionsExceededError,
} from "./whatsapp/index.js";
