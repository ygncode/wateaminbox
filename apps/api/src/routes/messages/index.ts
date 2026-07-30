/**
 * Message Routes
 *
 * Main router composing all message-related sub-routers:
 * - Fetch routes: Message listing and retrieval
 * - Send routes: Sending, forwarding, retrying messages
 * - Action routes: Star, delete operations
 * - Reaction routes: Add/remove reactions
 * - Batch routes: Bulk operations
 */
import { Hono } from "hono";
import { authMiddleware } from "../../middleware/auth.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { actionRoutes } from "./actions.js";
import { batchRoutes } from "./batch.js";
import { fetchRoutes } from "./fetch.js";
import { reactionRoutes } from "./reactions.js";
import { scheduledRoutes } from "./scheduled.js";
import { sendRoutes } from "./send.js";

export const messageRoutes = new Hono();

// All message routes require authentication and tenant context
messageRoutes.use("/*", authMiddleware);
messageRoutes.use("/*", tenantMiddleware());

// Mount scheduled routes first so /scheduled is never shadowed by :id params
// (POST /scheduled, GET /scheduled, DELETE /scheduled/:id)
messageRoutes.route("/", scheduledRoutes);

// Mount fetch routes at root level (GET /, GET /starred)
messageRoutes.route("/", fetchRoutes);

// Mount send routes at root level (POST /, POST /:id/forward, POST /:id/retry)
messageRoutes.route("/", sendRoutes);

// Mount action routes at root level (POST /:id/star, DELETE /:id/star, DELETE /:id)
messageRoutes.route("/", actionRoutes);

// Mount reaction routes at root level (POST /:id/reaction, DELETE /:id/reaction)
messageRoutes.route("/", reactionRoutes);

// Mount batch routes under /batch
messageRoutes.route("/batch", batchRoutes);
