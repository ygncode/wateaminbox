/**
 * Event handlers barrel export
 *
 * Provides all WhatsApp event handlers for the message-handler service.
 */

// Connection handlers
export {
  handleQREvent,
  handleConnectedEvent,
  handleDisconnectedEvent,
  handleWorkerConnectionStatusEvent,
} from "./connection-handlers.js";

// Message handlers
export {
  handleMessageEvent,
  handleReceiptEvent,
  handleSendConfirmationEvent,
  handleSendFailedEvent,
} from "./message-handlers.js";

// Status handlers
export {
  handleStatusEvent,
  handleSyncStatusEvent,
  handleDownloadResponseEvent,
} from "./status-handlers.js";

// Contact handlers
export {
  handleContactEvent,
  handleProfilePictureEvent,
  handlePresenceEvent,
  handleTypingEvent,
} from "./contact-handlers.js";

// Group administration handlers
export { handleGroupEvent } from "./group-handlers.js";

// Reaction handlers
export {
  handleReactionEvent,
  handleMessageRevokeEvent,
} from "./reaction-handlers.js";

// WhatsApp Business handlers
export {
  handleLabelsEvent,
  handleCatalogsEvent,
  handleCatalogProductsEvent,
  handleCommandResultEvent,
} from "./business-handlers.js";

// Error handlers
export { handleErrorEvent } from "./error-handlers.js";

export { handleHistorySyncPageEvent } from "./history-handlers.js";

// Types
export type { HandlerContext } from "./types.js";
