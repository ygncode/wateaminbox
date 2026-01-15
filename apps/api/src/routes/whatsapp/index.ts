/**
 * WhatsApp Routes
 *
 * Main router composing all WhatsApp-related sub-routers:
 * - Legacy routes: Backward-compatible single connection endpoints
 * - Connection routes: Multi-connection CRUD operations
 * - Status routes: Connection limits and sync status
 */
import { Hono } from "hono";
import { connectionRoutes } from "./connections.js";
import { legacyRoutes } from "./legacy.js";
import { statusRoutes } from "./status.js";

export const whatsappRoutes = new Hono();

// Mount legacy routes at root level for backward compatibility
// These routes: /connect, /disconnect, /status, /send, /connection
whatsappRoutes.route("/", legacyRoutes);

// Mount status routes at root level
// These routes: /limits, /sync-status, /sync-reset
whatsappRoutes.route("/", statusRoutes);

// Mount connection routes under /connections
// These routes: /connections, /connections/:id, /connections/:id/reconnect, etc.
whatsappRoutes.route("/connections", connectionRoutes);
