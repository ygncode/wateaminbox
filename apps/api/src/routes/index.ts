import { Hono } from "hono";
import { healthRoutes } from "./health.js";
import { authRoutes } from "./auth/index.js";
import { companyRoutes, invitationRoutes } from "./companies.js";
import { whatsappRoutes } from "./whatsapp/index.js";
import { contactRoutes } from "./contacts/index.js";
import { bulkJobRoutes } from "./bulk-jobs.js";
import { messageRoutes } from "./messages/index.js";
import { conversationRoutes } from "./conversations/index.js";
import { tagRoutes } from "./tags.js";
import { auditRoutes } from "./audit.js";
import { analyticsRoutes } from "./analytics.js";
import { exportRoutes } from "./export.js";
import { groupRoutes } from "./groups/index.js";
import { statusRoutes } from "./status.js";
import { searchRoutes } from "./search.js";
import { notificationRoutes } from "./notifications.js";
import { quickReplyRoutes } from "./quick-replies.js";
import { labelRoutes } from "./labels.js";
import { catalogRoutes } from "./catalogs.js";
import { mediaRoutes } from "./media.js";
import { debugRoutes } from "./debug.js";
import { feedbackRoutes } from "./feedback.js";
import { realtimeRoutes } from "./realtime/index.js";
import { actionsRoutes } from "./actions/index.js";
import { apiTokenRoutes } from "./api-tokens.js";
import { oauthRoutes } from "./oauth.js";
import { mcpRoutes } from "./mcp/index.js";

export const routes = new Hono();

// Health check routes
routes.route("/health", healthRoutes);

// Authentication routes
routes.route("/auth", authRoutes);

// Company routes
routes.route("/companies", companyRoutes);
routes.route("/invitations", invitationRoutes);

// WhatsApp routes
routes.route("/whatsapp", whatsappRoutes);

// Contact routes
routes.route("/contacts", contactRoutes);

// Message routes
routes.route("/messages", messageRoutes);

// Bulk broadcast job routes
routes.route("/bulk-jobs", bulkJobRoutes);

// Conversation routes (alternative to /messages for RESTful access)
routes.route("/conversations", conversationRoutes);

// Tag routes
routes.route("/tags", tagRoutes);

// API token management routes (web session authenticated)
routes.route("/api-tokens", apiTokenRoutes);
routes.route("/oauth", oauthRoutes);

// MCP endpoint (API token authenticated)
routes.route("/mcp", mcpRoutes);

// Audit routes
routes.route("/audit", auditRoutes);

// Analytics routes
routes.route("/analytics", analyticsRoutes);

// Export routes
routes.route("/export", exportRoutes);

// Group routes
routes.route("/groups", groupRoutes);

// Status routes
routes.route("/status", statusRoutes);

// Search routes
routes.route("/search", searchRoutes);

// Notification routes
routes.route("/notifications", notificationRoutes);

// Quick reply routes
routes.route("/quick-replies", quickReplyRoutes);

// Label sync routes
routes.route("/labels", labelRoutes);

// Catalog routes
routes.route("/catalogs", catalogRoutes);

// Media upload routes
routes.route("/media", mediaRoutes);

// Debug routes (development only)
routes.route("/debug", debugRoutes);

// Feedback routes (public)
routes.route("/feedback", feedbackRoutes);

// Realtime connection token route
routes.route("/realtime", realtimeRoutes);

// Client action routes (REST endpoints for real-time actions)
routes.route("/actions", actionsRoutes);

// API v1 routes
routes.get("/", (c) => {
  return c.json({
    name: "@wateaminbox/api",
    version: "0.1.0",
  });
});

/**
 * Export AppType for type-safe RPC client usage.
 *
 * Note: Due to the use of route mounting with `routes.route()`, full type inference
 * is limited. For complete type inference, individual route files would need to
 * use method chaining. This export provides basic type safety for the main router.
 *
 * @example
 * ```typescript
 * // In frontend client
 * import { hc } from 'hono/client'
 * import type { AppType } from '@wateaminbox/api'
 *
 * const client = hc<AppType>('http://localhost:4445/api')
 * ```
 */
export type AppType = typeof routes;
