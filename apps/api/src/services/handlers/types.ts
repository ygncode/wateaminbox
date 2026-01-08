/**
 * Shared types and utilities for event handlers
 */

import { createLogger } from "../../lib/logger.js";

// Shared logger for all handlers
export const handlerLogger = createLogger("MessageHandler");

/**
 * Handler context - common data passed to all handlers
 */
export interface HandlerContext {
  companyId: string;
  connectionId?: string;
  timestamp: string;
}
