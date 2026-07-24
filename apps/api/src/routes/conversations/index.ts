import { Hono } from "hono";
import { authMiddleware } from "../../middleware/auth.js";
import { requireContactVisibility } from "../../middleware/resource-visibility.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { analyticsRoutes } from "./analytics.js";
import { messageRoutes } from "./messages.js";
import { stateRoutes } from "./state.js";

export const conversationRoutes = new Hono();

// All conversation routes require authentication and tenant context
conversationRoutes.use("/*", authMiddleware);
conversationRoutes.use("/*", tenantMiddleware());
conversationRoutes.use("/:id/*", requireContactVisibility());

// Mount analytics routes first (more specific path matching)
conversationRoutes.route("/", analyticsRoutes);

// Mount state and message routes
conversationRoutes.route("/", stateRoutes);
conversationRoutes.route("/", messageRoutes);
