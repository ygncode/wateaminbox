import { Hono } from "hono";
import { authMiddleware } from "../../middleware/auth.js";
import { requireContactVisibility } from "../../middleware/resource-visibility.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { analyticsRoutes } from "./analytics.js";
import { messageRoutes } from "./messages.js";
import { stateRoutes } from "./state.js";

export const conversationRoutes = new Hono();

// All conversation routes require authentication and tenant context.
conversationRoutes.use("/*", authMiddleware);
conversationRoutes.use("/*", tenantMiddleware());

// Analytics paths begin with `/stats`, which Hono also matches as `/:id/*` with
// `id = "stats"`. Mount them before the per-contact visibility middleware so
// aggregate analytics are governed by their dashboard permission instead of a
// bogus contact lookup.
conversationRoutes.route("/", analyticsRoutes);

// Resource routes below this point address a real contact ID.
conversationRoutes.use("/:id/*", requireContactVisibility());
conversationRoutes.route("/", stateRoutes);
conversationRoutes.route("/", messageRoutes);
