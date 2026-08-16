/**
 * Group Routes
 *
 * Main router composing all group-related sub-routers:
 * - CRUD routes: List, get, create, rename (workspace alias)
 * - Member routes: Participant management (add, remove, promote, demote)
 * - Settings routes: Permissions, leaving, invite links, join requests
 *
 * Three guards apply, in this order:
 *
 *  1. Authentication and tenant context, as everywhere else.
 *  2. Contact visibility on `/:id` - a member who cannot see the conversation
 *     gets 404 rather than a hint that it exists.
 *  3. `can_send_messages` on every mutating route. Group administration acts
 *     outward as the workspace's WhatsApp account, exactly like sending, so a
 *     member who may not send may not administer groups either.
 *
 * The per-group checks WhatsApp itself enforces - is this account still a
 * member, is it an admin, is its connection live - are applied per route by
 * `loadGroupContext`.
 */
import { Hono } from "hono";
import { authMiddleware } from "../../middleware/auth.js";
import { requireMessageSendPermission } from "../../middleware/message-send-policy.js";
import { requireContactVisibility } from "../../middleware/resource-visibility.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { crudRoutes } from "./crud.js";
import { memberRoutes } from "./members.js";
import { settingsRoutes } from "./settings.js";

export const groupRoutes = new Hono();

// All group routes require authentication and tenant context
groupRoutes.use("/*", authMiddleware);
groupRoutes.use("/*", tenantMiddleware());
groupRoutes.use("/:id", requireContactVisibility());
groupRoutes.use("/:id/*", requireContactVisibility());

// Every route that reaches WhatsApp needs the outbound-action permission.
// Creating a group has no contact to scope visibility against, so it is
// guarded by permission alone.
groupRoutes.post("/", requireMessageSendPermission);
groupRoutes.post("/:id/*", requireMessageSendPermission);
groupRoutes.patch("/:id/*", requireMessageSendPermission);
// The deprecated single-participant remove route is a DELETE; it needs the same
// guard as its POST replacement.
groupRoutes.delete("/:id/*", requireMessageSendPermission);

// Mount CRUD routes at root level (GET /, POST /, GET /:id, PATCH /:id)
groupRoutes.route("/", crudRoutes);

// Mount member routes at root level (POST /:id/participants/...)
groupRoutes.route("/", memberRoutes);

// Mount settings routes at root level (PATCH /:id/settings, POST /:id/leave, ...)
groupRoutes.route("/", settingsRoutes);
