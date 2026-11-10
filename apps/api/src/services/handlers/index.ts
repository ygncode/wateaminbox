/**
 * Event handlers barrel export
 *
 * Provides all WhatsApp event handlers for the message-handler service.
 */

// WhatsApp Business handlers
export {
  handleCatalogProductsEvent,
  handleCatalogsEvent,
  handleCommandResultEvent,
  handleLabelsEvent,
} from "./business-handlers.js";
// Connection handlers
export {
  handleConnectedEvent,
  handleDisconnectedEvent,
  handleQREvent,
  handleWorkerConnectionStatusEvent,
} from "./connection-handlers.js";
// Contact handlers
export {
  handleContactEvent,
  handlePresenceEvent,
  handleProfilePictureEvent,
  handleTypingEvent,
} from "./contact-handlers.js";
// Error handlers
export { handleErrorEvent } from "./error-handlers.js";

// Group administration handlers
export { handleGroupEvent } from "./group-handlers.js";
export { handleHistorySyncPageEvent } from "./history-handlers.js";
// Message handlers
export {
  handleMessageEvent,
  handleReceiptEvent,
  handleSendConfirmationEvent,
  handleSendFailedEvent,
} from "./message-handlers.js";
// Reaction handlers
export {
  handleMessageRevokeEvent,
  handleReactionEvent,
} from "./reaction-handlers.js";
// Status handlers
export {
  handleDownloadResponseEvent,
  handleStatusEvent,
  handleSyncStatusEvent,
} from "./status-handlers.js";

// Types
export type { HandlerContext } from "./types.js";
