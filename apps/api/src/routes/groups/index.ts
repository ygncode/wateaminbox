/**
 * Group Routes
 *
 * Main router composing all group-related sub-routers:
 * - CRUD routes: List, get, update groups
 * - Member routes: Participant management (promote, demote, remove)
 * - Settings routes: Group settings and admin status
 */
import { Hono } from "hono";
import { authMiddleware } from "../../middleware/auth.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { crudRoutes } from "./crud.js";
import { memberRoutes } from "./members.js";
import { settingsRoutes } from "./settings.js";

export const groupRoutes = new Hono();

// All group routes require authentication and tenant context
groupRoutes.use("/*", authMiddleware);
groupRoutes.use("/*", tenantMiddleware());

// Mount CRUD routes at root level (GET /, GET /:id, PATCH /:id)
groupRoutes.route("/", crudRoutes);

// Mount member routes at root level (POST /:id/participants/..., DELETE /:id/participants/...)
groupRoutes.route("/", memberRoutes);

// Mount settings routes at root level (PATCH /:id/settings, GET /:id/admin-status)
groupRoutes.route("/", settingsRoutes);
