/**
 * Company routes barrel export
 *
 * Composes all company sub-routers into a single exported router.
 */

import { Hono } from "hono";
import { crudRoutes } from "./crud.js";
import { invitationRoutes, tokenInvitationRoutes } from "./invitations.js";
import { memberRoutes } from "./members.js";
import { permissionRoutes } from "./permissions.js";
import { slaPolicyRoutes } from "./sla-policy.js";

// Main company routes - mounted at /companies
export const companyRoutes = new Hono();

// Mount sub-routers
companyRoutes.route("/", crudRoutes);
companyRoutes.route("/", memberRoutes);
companyRoutes.route("/", invitationRoutes);
companyRoutes.route("/", permissionRoutes);
companyRoutes.route("/", slaPolicyRoutes);

// Separate invitation routes for token-based acceptance (mounted at /invitations)
// Re-export with the name expected by the main routes file
export { tokenInvitationRoutes as invitationRoutes };
