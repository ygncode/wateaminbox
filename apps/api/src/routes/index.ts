import { Hono } from "hono";
import { healthRoutes } from "./health.js";
import { authRoutes } from "./auth/index.js";
import { companyRoutes, invitationRoutes } from "./companies.js";
import { whatsappRoutes } from "./whatsapp/index.js";
import { wsRoutes } from "./ws/index.js";
import { contactRoutes } from "./contacts.js";
import { messageRoutes } from "./messages/index.js";
import { conversationRoutes } from "./conversations.js";
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

// Conversation routes (alternative to /messages for RESTful access)
routes.route("/conversations", conversationRoutes);

// Tag routes
routes.route("/tags", tagRoutes);

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

// WebSocket routes
routes.route("/ws", wsRoutes);

// API v1 routes
routes.get("/", (c) => {
  return c.json({
    name: "@whatsapp-web/api",
    version: "0.1.0",
  });
});
